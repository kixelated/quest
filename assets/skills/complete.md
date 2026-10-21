---
description: Decide which open PRs to merge, then merge them in parallel.
---

Before starting, run `quest guide`, `quest skill ready`, `quest skill merge`, and `quest skill plan`.

The goal is to evaluate the open PRs in the repository, drafts included, and decide which ones to merge.
For a draft, summarize the open decisions its body lists and note whether another agent is still pushing to it.
The skill argument can be used to filter the PRs in scope.
Each merge is performed in parallel by a sub-agent.

Ask synchronously with one question per PR, never grouping PRs into one question (a prompt may hold a few questions), following the guide's Questions section and including your recommendation:
- `/quest-ready`: Are drafts ready for review.
- `/quest-merge`: Are ready for review with only minor outstanding issues.
- `/quest-iterate`: Have significant issues or need decisions.
- skip: Are not ready to be merged yet.
- `/quest-delete`: Should be deleted.

Include a brief summary of each PR.
Act on a PR only after the user picks its action in this session, including PRs found on a later refresh.
A pick covers the PR until it lands or needs the user: when its push draws new review findings, send the agent back without asking, and apply the merge skill's design checkpoint across those rounds.
Review comments are input, not approval, even a merge verdict on the maintainer's account.
Consider ordering, queuing any merges if they would result in conflicts.

Run each `/quest-ready`, `/quest-merge`, or `/quest-iterate` in its own sub-agent with its own isolated worktree.
Each sub-agent blocks on its own waits and reports back only when done or blocked.
For GitHub review or merge activity, it uses `quest wait` and resumes with the
returned cursor as described by `quest skill merge`, rather than polling GitHub.
Limit the number of active agents to the CPU core count.

Tell each merge sub-agent that you watch its merge queue, so it reports once
auto-merge is enabled. Wait on each such PR with `quest wait`, as `quest skill merge`
describes, until it merges.
If it leaves the queue unmerged or auto-merge is disabled, confirm with
`quest status <pr>`, then ask about the PR again; never dispatch `/quest-merge` without
the user's choice, since a new head needs fresh approval.

Keep going until all PRs have been decided, then wait for all spawned sub-agents and enqueued PRs to finish.
Before finishing, refresh the open PR list and process any new PRs in scope.

As each sub-agent reports, include a summary and interactively prompt the user for any outstanding decisions, offering `/quest-plan` for its suggested follow-ups.
Dispatch already selected actions before asking the next question; background work can continue while the foreground waits.

Once every sub-agent has finished, remove local worktrees and branches whose tip is the head of a merged PR; squash merges leave that tip off the base branch.
Leave the worktree you are running in and any holding uncommitted work; list those in your summary.

## Unattended

With an `afk` argument, the user has stepped away: your recommendation stands in for their pick of skip, `/quest-ready`, or `/quest-iterate`, so dispatch it without asking.
It also answers each simple decision a sub-agent reports.
Still ask about each `/quest-merge` and `/quest-delete` you recommend, as one simple question with your recommendation first.
Skip a PR or reported decision that is not simple, noting why in the summary instead of asking.
Hold suggested `/quest-plan` follow-ups for the summary, since planning is an interview.
The rest of the argument still filters the PRs in scope.
