---
description: Decide which open PRs to merge, then merge them in parallel.
---

Before starting, run `quest guide`, `quest skill review`, `quest skill merge`, and `quest skill plan`.

The goal is to evaluate the open PRs in the repository, drafts included, and decide which ones to merge.
For a draft, summarize the open decisions its body lists.
Read each PR with `quest status` and skip one another session holds, using its `hold` and `starter-hold` records instead of a separate label read. A `hold` names the label, acquisition token/time, event URL, and age. A `starter-hold` identifies a draft without a `## Decisions needed` section and reports when it was last active; that is not an acquisition time.
List those with how long ago each was last active, and offer to take over only one that looks stale.
The skill argument can be used to filter the PRs in scope.
Merges proceed in parallel, each with its own workers, following the guide's Reviews section for the shared design checkpoint across review rounds.

Ask synchronously with one question per PR, never grouping PRs into one question (a prompt may hold a few questions), following the guide's Questions section and including your recommendation:
- `/quest-review`: Are drafts ready for review.
- `/quest-merge`: Are ready for review with only minor outstanding issues.
- `/quest-iterate`: Have significant issues or need decisions.
- skip: Are not ready to be merged yet.
- `/quest-delete`: Should be deleted.

Include a brief summary of each PR.
Act on a PR only after the user picks its action in this session, including PRs found on a later refresh.
A blanket answer, such as "accept all" or "use your recommendations", picks your recommendation for every PR in scope, `/quest-merge` included, except a PR whose recommendation settles a decision you have not yet shown; ask about those.
A skip or hold stands until the user lifts it: do not ask about that PR again on a refresh, and state the hold in every sub-agent brief for it.
GitHub auto-merge is that pick: enabling it takes write access, and GitHub disables it when anyone without write access pushes.
Do not ask about a PR with auto-merge enabled; leave it to land, and dispatch `/quest-merge` only when a conflict, failing check, or review finding stalls it.
A pick covers the PR until it lands or needs the user: when its push draws new review findings, start a fresh worker without asking; the merge skill's design checkpoint counts rounds from the PR, so it fires across those workers.
Review comments are input, not approval, even a merge verdict on the maintainer's account.
Consider ordering, queuing any merges if they would result in conflicts.

Coordinate each `/quest-review`, `/quest-merge`, or `/quest-iterate` yourself, giving its edits to background workers, each with its own isolated worktree, as the guide's Workspace section describes.
Never wait or poll for GitHub activity, and do not watch the queue or wait for merges: report each PR once it is landing.
An open PR that left the queue unmerged shows why under `landing-stopped` in `quest status <pr>`.
After `merge_conflict`, `failed_checks`, or `checks_pending`, its pick still holds, even from an earlier session: dispatch `/quest-merge` again without asking.
Any other reason, such as a person removing it, is the user's call, so ask about the PR again.

Keep going until all PRs have been decided, then wait for all workers to finish.

As each worker reports, include a summary and interactively prompt the user for any outstanding decisions.
Refresh the open PR list whenever a worker reports, and once more before finishing; ask about each new PR in scope the same way.
Collect each PR's suggested follow-ups, and once every worker has finished, run `/quest-plan` on them without asking first; its interview lets the user drop any.
Dispatch already selected actions before asking the next question; background work can continue while the foreground waits.

Once every worker has finished, remove local worktrees and branches whose tip is the head of a merged PR; squash merges leave that tip off the base branch.
Leave the worktree you are running in and any holding uncommitted work; list those in your summary.
