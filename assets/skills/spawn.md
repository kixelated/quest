---
description: Start multiple quests in parallel.
---

Before you begin, run `quest guide` and read its output completely.

Your goal is to execute many quests in parallel.
The scope consists of all ready quests that are not claimed.
Run `quest unblocked --json` for ready candidates in milestone priority, descending downstream impact, then tree order.
The count is distinct transitive dependents; other prerequisites may still remain.
Use that order when dispatching, and recompute after the quest tree changes.
An explicit argument takes precedence: filter to the selected quests/epics and honor their requested order.
Ranking does not establish that work is unclaimed: verify live locks, open changes, and remote branch claims before starting.
For a quest waiting on an outside condition, check whether it has cleared before recommending.

Start every quest you would recommend starting, without asking: well planned, with no blockers or conflicts with quests already started.
Print each quest you skip and why, suggesting `/quest-plan` for any with significant design issues.

Ask only when unsure, such as a quest that may not be worth implementing or may not be worth doing now.
Present those one at a time: a short paragraph explaining the problem, the quest's goal, and your recommendation, then one synchronous question following the guide's Questions section, offering:

- `/quest-start`: If the quest should start now.
- skip: If the quest should not be started yet.
- deprioritize: If the quest should wait behind other work; `/quest-plan` moves it down.
- `/quest-delete`: If the quest should be deleted.

Start each quest in a background sub-agent with its own isolated worktree, since agents cannot write to a worktree their parent created.

Each agent reports back only when done or blocked.
Limit the number of active agents to the physical CPU core count.
Other sessions share this machine: hold new agents while the load average exceeds the core count.

When done, each agent opens a PR, a draft if decisions or unfinished work remain.
Its report lists every open decision and suggested follow-up with a recommendation.
Report each sub-agent's final status, staying silent on interim notifications, but do not monitor their PRs.

As each agent reports, explain its result in a few lines, then ask about its PR in the same way, offering:

- `/quest-ready`: If the PR is a draft ready for review.
- `/quest-merge`: If the PR is ready for review with no significant issues.
- `/quest-iterate`: If the PR has significant issues or needs decisions.
- skip: If the PR should not be merged yet.
- `/quest-delete`: If the quest should be deleted.

Also offer `/quest-plan` for its suggested follow-ups.
Include quest context, as many quests are concurrently in flight.

Run each selected `/quest-ready`, `/quest-merge`, or `/quest-iterate` in a background sub-agent with its own isolated worktree, as for `/quest-start`.
Run selected `/quest-plan` sessions in the foreground.

Once every sub-agent has finished, remove local worktrees and branches whose tip is the head of a merged PR; squash merges leave that tip off the base branch.
Leave the worktree you are running in and any holding uncommitted work; list those in your summary.
