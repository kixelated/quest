# [M] Own PRs with quest iterate, ready, and merge

## Goal

Before a session pushes to an existing PR, it takes the PR with
`quest iterate`, `quest ready`, or `quest merge`. Each command labels the PR
with its state and does that state's GitHub step. `quest release` hands it
back. Two sessions never iterate or merge one PR at once, and any PR on its
way in shows `quest:merge` on GitHub.

## Plan

Decided 2026-10-20 (user) from the transcript audit recorded in
[quest start](/quest/m0/helpers/start.md). Overlapping merge sessions in one
repository drew "another agent was merging, I told them to stop, can you take
over anything needed?", and the same-machine guard flagged sessions in other
repositories ("those are in another repo?").

- Decided (user): one owner per PR replaces "one merge agent per
  repository". There is no repository-wide merge lock or coordinator.
  GitHub's merge queue, or the repository's own queue, orders landings, and a
  PR that conflicts goes back to its owner.
- Decided (user): a label per state, with no owner comment:
  `quest:iterate`, `quest:ready`, and `quest:merge`. At most one is on a
  PR. Planning PRs get none. A draft that its starter still holds, one with no
  `## Decisions needed` section (see [quest start](/quest/m0/helpers/start.md)),
  counts as owned too, so every command refuses it until the starter hands
  back; taking it over from a stale starter is the user's choice. Decided
  2026-10-21 (user), replacing a `quest:start` label.
- Decided (user): a command per state, each doing its GitHub step. Every
  command refuses while any `quest:*` label is on the PR that this session
  does not hold, including its own state's, then swaps in its own, using the
  label helper, which this quest adds: take a label only when no `quest:*`
  label is on the PR, and back off if another appears in the timeline
  first.
- The label holds no owner identity, and sessions often share one GitHub
  account, so taking a label prints a hold token: the ID of the timeline
  event that added it. A swap, `--done`, `--land`, and `quest release` take
  that token and refuse unless it is still the latest add of the PR's
  current label. A stale label is offered to the user for takeover instead.
  - `quest iterate <pr>` only takes the PR.
  - `quest ready <pr>` takes a handed-back draft and, once its decisions are
    settled, marks it ready for review with `--done`, removing the
    `## Decisions needed` section.
  - `quest merge <pr>` takes it for the fix loop. `quest merge --land <sha>`
    enables auto-merge bound to that full head SHA, which also enters
    GitHub's merge queue.
  - `quest release <pr> <token>` removes the label that token holds.
- Decided (user): `quest:merge` stays on through the fix loop and while the
  PR is queued or auto-merging, until it merges. If it leaves the queue
  unmerged, the command that notices removes the label, and the PR is idle
  and waits on the maintainer's pick again.
- Decided 2026-10-21 (user), replacing a carve-out for moq-dev/moq.pro's
  `merge` label queue, which the user means to remove: `--land` makes a merge
  commit by default (`gh pr merge --merge`), through GitHub's merge queue
  when the base has one. `--squash` or `--rebase` selects another method;
  the command never reads prose, so the merge skill picks the flag from the
  method a repository's root instructions name for that base. The merge
  skill named no method, so an agent squashed a PR into moq-dev/moq's
  `release`, which needs a merge commit.
- Every command refuses a merged or closed PR, because a push after the merge
  brings the deleted branch back.
- A merge pick covers the fixes its own agent pushes for conflicts, CI, and
  review findings. A head moved by anyone else, a design change, or the merge
  skill's design checkpoint asks the user again, as `complete` already says.
- Accept the same PR argument as `quest wait`. Commands never decide whether
  a PR should merge; the agent and the user still do.
- Update the `iterate`, `ready`, `merge`, and `complete` skills to take the
  PR before acting and release it at hand-back, and to skip PRs other
  sessions hold. Replace the merge skill's raw auto-merge call with
  `quest merge --land`. The user asked for those edits through this plan.
- Test a refused draft its starter still holds, a race for one PR, two
  sessions taking the same state, a release
  with a stale token, a refused swap, landing on a moved head, a PR
  leaving the queue, a refused merged PR, the default merge commit, and
  `--squash` and `--rebase`.

## Required

- [quest start](/quest/m0/helpers/start.md) - the hand-back marker and the freed `ready` name
