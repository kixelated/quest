# [M] Land picked PRs through merge jobs

## Goal

Picking "merge" on a PR that is not yet clean starts a merge job on one of
the maintainer's runners. The job runs the merge skill's loop: it fixes
conflicts, failing CI, and review findings, then lands the PR through
GitHub. The pick covers the job's own fixes, so the maintainer is asked
again only for real decisions. Any number of merge jobs run at once, one per
PR.

## Plan

Decided 2026-10-20 (user) from the transcript audit recorded in
[quest start](/quest/m0/helpers/start.md). Locally, a long-lived
`/quest-complete` session per repository (median about 31 PR merges in moq)
sends sub-agents to fix PRs, and the user's pick covers a PR until it lands
or needs them.

- Decided (user): one owner per PR, not one merge agent per repository. kix
  never runs two jobs on one PR and never acts on a PR another session holds.
  GitHub's merge queue, or the repository's own queue, orders landings.
- Decided (user): use the `quest:merge` label from the
  [PR state commands](/quest/m0/helpers/pr-states.md). The bot adds it when
  the job is assigned and keeps it while the PR is queued or auto-merging. If
  the PR leaves the queue unmerged, the bot removes it and the PR becomes an
  idle decision item again. Runners hold no GitHub credentials, so the
  service applies labels and the job's instructions say so.
- Decided (user): the pick covers the job's own pushes for conflicts, CI, and
  review findings. A head moved by anyone else, a design change, or the merge
  skill's design checkpoint pauses the job into a decision. The
  [inbox merge](/quest/m0/kix/merge.md) button keeps its exact-head binding
  for a PR that is already clean.
- Widen the inbox merge button: a maintainer sees merge on an open PR that
  is not clean (conflicted, failing, or unreviewed), and picking it starts
  this job. A clean PR keeps the direct exact-head merge.
- Land by enabling auto-merge bound to the head the job verified, unless the
  repository's root instructions name another landing step.
- Add a `merge` workflow beside plan, start, iterate, and bootstrap in
  `cloudflare/src/jobs/store.ts`, reusing the same runners, prompt contract,
  and publisher.
- Test a pick on a conflicted PR, a review round that the pick covers, a
  head moved outside the job, the design checkpoint, a PR that leaves the
  queue, and a PR already labeled by a local session.

## Required

- [Runner](/quest/m0/kix/runner.md) - jobs that run the merge skill
- [PR state commands](/quest/m0/helpers/pr-states.md) - the label contract kix shares with local sessions
- [Inbox merge](/quest/m0/kix/merge.md) - the merge button this widens to unclean PRs
