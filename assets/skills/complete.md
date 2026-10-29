---
description: Decide which open PRs to merge, then merge them in parallel.
---

Before starting, run `quest guide`, `quest skill review`, `quest skill merge`, and `quest skill plan`.

The goal is to evaluate the open PRs in the repository, drafts included, and decide which ones to merge.
For a draft, summarize the open decisions its body lists.
Read each PR with `quest status` and skip one another session holds, using its `hold` and `starter-hold` records instead of a separate label read. A `hold` names the label, acquisition token/time, event URL, and age. A `starter-hold` identifies a draft without a `## Decisions needed` section and reports when it was last active; that is not an acquisition time.
List those with how long ago each was last active, and offer to take over only one that looks stale.
The skill argument can be used to filter the PRs in scope.
Each merge is performed in parallel by a sub-agent, following the guide's Reviews section for the shared design checkpoint across review rounds.

Ask synchronously with one question per PR, never grouping PRs into one question (a prompt may hold a few questions), following the guide's Questions section and including your recommendation:
- `/quest-review`: Are drafts ready for review.
- `/quest-merge`: Are ready for review with only minor outstanding issues.
- `/quest-iterate`: Have significant issues or need decisions.
- skip: Are not ready to be merged yet.
- `/quest-delete`: Should be deleted.

Include a brief summary of each PR.
Act on a PR only after the user picks its action in this session.
A blanket answer, such as "accept all" or "use your recommendations", picks your recommendation for every PR in scope, `/quest-merge` included, except a PR whose recommendation settles a decision you have not yet shown; ask about those.
A skip or hold stands until the user lifts it: do not dispatch that PR again, and state the hold in every sub-agent brief for it.
GitHub auto-merge is that pick: enabling it takes write access, and GitHub disables it when anyone without write access pushes.
Do not ask about a PR with auto-merge enabled; leave it to land, and dispatch `/quest-merge` only when a conflict, failing check, or review finding stalls it.
A pick covers the PR until it lands or needs the user. A separate GitHub monitor may dispatch a new local attempt for new failures or review findings under that pick; the merge skill's design checkpoint counts rounds across those attempts.
Review comments are input, not approval, even a merge verdict on the maintainer's account.
Consider ordering, queuing any merges if they would result in conflicts.

Run each `/quest-review`, `/quest-merge`, or `/quest-iterate` in its own sub-agent with its own isolated worktree.
Each sub-agent finishes its local checks and review, publishes or hands off its result, and terminates.
It blocks only on local work and never waits or polls for GitHub activity.

Merge sub-agents report once their PR is landing; do not watch the queue or wait for merges.
An open PR that left the queue unmerged shows why under `landing-stopped` in `quest status <pr>`.
After `merge_conflict` or `failed_checks`, an existing durable `quest:merge` pick still authorizes a new local attempt. Report the label/token at handoff so a later monitor or invocation can resume it; do not stay alive for that event.
Any other reason, such as a person removing it, is the user's call, so ask about the PR again.

Keep going until all PRs have been decided, then wait for all spawned sub-agents to finish.
Work from the initial PR snapshot. Later GitHub activity belongs to a separate monitor or a new user invocation.

As each sub-agent reports, include a summary and interactively prompt the user for any outstanding decisions.
Collect each published PR's suggested follow-ups and include them in the handoff for a later `/quest-plan` invocation.
Dispatch already selected actions before asking the next question; background work can continue while the foreground waits.

Once every sub-agent has finished, report the published and queued PRs and terminate. Remove local worktrees and branches only when a merge is already known; squash merges leave that tip off the base branch.
Leave the worktree you are running in and any holding uncommitted work; list those in your summary.
