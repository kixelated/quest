# Quests

Read this file whenever work mentions a quest or questline.

Quests are optional, versioned plans for work that needs durable scope, memory,
or coordination. Think GitHub issues checked into the repository. GitHub issues can remain the public front door; quests keep agreed scope beside
its implementation.

## Model

- A quest is a task completed independently in a single PR. It is a Markdown
  file such as `archive.md`.
- A questline is a directory. Its `README.md` lists the children in `Quests`
  and holds the work no child owns. While children remain, that README is the
  index and is not started. Once they have merged, the `Quests` section is
  gone and the README is an ordinary quest: the line's own remaining work.
  The line is complete when that quest lands.
- Everything lives under `quest/`. [README.md](README.md) is the permanent root
  questline.
- The root's entries are milestone questlines named `m0`, `m1`, `m2`, and so on,
  as described below.
- A document's branch is its path without `.md`: `quest/m1/foo/bar.md` is
  branch `quest/m1/foo/bar`, and its line is `quest/m1/foo/README`. A quest
  merges into its line's branch, a line into its parent's, and a milestone's
  direct children into `main`. The root and the milestones have no branch.
- Every `Quests` list is ordered by priority, most important first; ready
  quests are taken in list order. Insert a new quest or questline at its rank
  rather than appending - including the root, where new work joins the
  milestone matching its priority.
- Quests and questlines reference each other with root-absolute links.
- Finished quests and questlines are deleted and remain accessible through git
  history.
- Merge conflicts are expected. Resolve them by aligning quests.

## Milestones

- Each milestone is a directory such as `quest/m0/`, with a `README.md` stating
  its `Goal` and listing any `Quests` in priority order. The root
  `quest/README.md` lists milestones in priority order.
- Start with `m0` for the first delivery horizon, `m1` for the following horizon,
  and `m2` and beyond for later work. Give each milestone a concrete outcome;
  the repository decides whether that means a release, capability, or other
  delivery boundary.
- Include agreed future work in later milestones so it remains visible without
  becoming a requirement of the current milestone. Do not create empty
  milestones just to reserve numbers.
- Lower numbers have higher priority. Milestone order does not create a
  dependency: use a quest's `Required` section for actual blockers, including
  any dependency on an entire earlier milestone.
- Keep milestone numbers stable. Completing `m0` does not rename `m1` to `m0`,
  and gaps are valid. Remove a completed milestone and its root entry using the
  normal questline deletion rules.
- The root and the milestones are permanent. After a milestone's quests are
  gone it stays as a horizon: it is not a quest, needs no size, and omits
  `Quests` until it has children again.
- A milestone may open with a gate quest for a release or external condition
  that later quests explicitly require; see Creation.

## Format

A quest:

```markdown
# [S] Short title

## Goal

The observable outcome and important boundaries.

## Plan

Current decisions, open questions, or implementation guidance.

## Required

- [Blocker](/quest/foo/bar.md) - work that must finish before this can start

## Closes

- [#701](https://github.com/OWNER/REPO/issues/701) - close this issue when the quest finishes

## Related

- [Other](/quest/other/quest.md) - similar work that is not a blocker
```

`Goal` is required. Prefix the title with `[XS]`, `[S]`, `[M]`, `[L]`, or
`[XL]`, estimating implementation, verification, and landing work. A README
that still lists children carries no size. A README with no `Quests` section
is a plain quest and needs one. The root and the milestones are neither.
Every other section is optional. Use these exact headings: readiness checks
grep for `## Required` literally.

A questline README lists its children under `Quests`, in priority order, each
with a one-line summary. The permanent root may have an empty `Quests` section
when no work is planned:

```markdown
## Quests

- [Child quest](/quest/foo/bar.md) - the outcome, so the list reads without opening it
- [Nested questline](/quest/foo/baz/README.md) - what the whole line delivers
```

- A quest's `Required` section lists its blockers. Its absence means the quest
  is ready to start.
- A quest may require a questline; that blocker clears only when the whole
  line has merged, including the README's own quest.
- A `Required` bullet may be plain text naming a condition outside the
  repository; remove it when the condition clears.
- `Required` relationships must be acyclic. Before adding one, follow links
  from the target and ensure they cannot reach the current file.
- `quest check` enforces this section mechanically -
  links resolve, the index matches the file tree, headings stay inside the set
  above, and `Required` stays acyclic. Run it before submitting quest changes.
- `quest ready <quest>` reads the same section the other way: it prints what
  blocks that quest, one per line, expanding a required questline into the
  quests it still holds. `quest ready` with no path lists every ready quest in
  tree order. A README with no `Quests` left is ready work, same as any other
  quest. Both exit 0, so the printed list is the answer: no output means
  ready. From this source checkout, run `cargo run --quiet --locked -- ready ...`.
  It reads the tree and nothing else, so a quest an unrelated PR already
  finished still reports ready; that question is GitHub's.
- `quest branch <path>` prints the branch for that document, then every branch
  it merges through, nearest first and ending at `main`. It reads the path
  only. The root and milestones have no branch, and the command fails on them.

## Creation

- Quests are created in PRs and reviewed.
- Size every quest in its title. Re-estimate it when scope changes materially.
- Search the living tree and git history before creating a quest.
- Split independently completable work into separate quests. Group them in a
  questline only when they ship together, and give the README the work no
  child owns: the end-to-end test, the docs page. A one-off sits directly in
  its parent.
- For GitHub repositories using the `quest` label, apply it to issues listed
  under `Closes` when the quest lands and issue updates are authorized. A
  `Related` link is context, not tracking, and gets no label.
- Represent a release or pin bump that unblocks repository work as its own
  quest, holding the external condition as a plain-text `Required` bullet, and
  make every dependent quest require it. When the condition clears, remove the
  bullet, do the work, and complete the quest; one completion unblocks every
  dependent.

## Execution

- Only quests are executed, and only when ready: no `Required` section means no
  blockers. A questline README is not a quest while it still has `Quests`.
- `quest branch` names the branch and its bases. When remote writes are
  authorized, push each missing line branch from the one after it and open its
  draft PR against that base, then push the quest's branch with an empty
  placeholder commit. Check for existing claims first. The remote branch is
  the claim; continue only if an existing one is stale (old, no open PR).
  Work locally when remote access is unavailable.
- Keep a shared line current by merging its base in. Do not rebase it.
- A line's PR stays a draft until its `Quests` list is empty. The PR that
  removes the last child gives the README a sized title. That README is then
  a ready quest. Completing it is what makes the line's PR ready to merge.
  Merging is a separate invocation.
- Quests may be updated over time as the plan changes.
- A quest is completed when the plan is executed and no further work is needed.
  Suggest follow-up work as a new quest.
- Run the repository's checks from `CONTRIBUTING.md`, including `quest check`,
  before completing the change.
- When the quest is complete, open a PR per
  [CONTRIBUTING.md](../CONTRIBUTING.md), with a GitHub closing keyword for every
  issue listed under `Closes` by the quest and by any questline the same PR
  completes. A line's issues usually live on its README, and the PR that
  completes that README is the one that closes them.

## Deletion

- A quest that is no longer needed or cannot be completed is abandoned: delete
  it and explain why in the PR.
- Abandoning a quest removes the `quest` label from any issue it listed under
  `Closes` that no other quest tracks.
- The quest is deleted in the same PR that completes or abandons it.
- When deleting a quest or questline, grep its absolute path and remove every
  reference; this reveals every quest the finished work unblocks. If the
  removed link was the last entry in a section, remove the heading too.
- Completing or abandoning a README deletes its directory in the same change.
  Removing its last child does not: take the `Quests` heading off and leave
  the README as the line's remaining quest. The root and the milestones stay;
  an empty milestone remains a horizon.
