---
description: Start multiple quests in parallel.
---

Before you begin, run `quest guide` and read its output completely.

Your goal is to execute many quests in parallel.
The scope consists of all ready quests that are not claimed.
Use the argument (if provided) to filter to specific quests/questlines.
For a quest waiting on an outside condition, check whether it has cleared before recommending.

Present one quest at a time. Before its question, write a short paragraph explaining the problem, the quest's goal, and your recommendation, including any blockers or tradeoffs the user needs to decide.
Ask one synchronous question and wait for the answer before asking the next, following the guide's Questions section.
Offer these choices:

- `/quest-start`: If the quest is well planned with no blockers.
- `/quest-plan`: If the quest has significant design issues.
- skip: If the quest should not be started yet.
- deprioritize: If the quest should wait behind other work; `/quest-plan` moves it down.
- `/quest-delete`: If the quest should be deleted.

Consider ordering, suggesting to skip any quests that would result in conflicts.

Only after the user chooses `/quest-start` for that quest, spawn a background sub-agent with its own isolated worktree, since agents cannot write to a worktree their parent created.

Each agent reports back only when done or blocked.
Limit the number of active agents to the physical CPU core count.
Other sessions share this machine: hold new agents while the load average exceeds the core count.

When done, each agent opens a draft PR.
Its report lists every open decision and suggested follow-up with a recommendation.
Report each sub-agent's final status, staying silent on interim notifications, but do not monitor their PRs.

As each agent reports, explain its result in a few lines, then ask about its PR in the same way, offering:

- `/quest-merge`: If the PR is ready to be merged.
- `/quest-iterate`: If the PR has significant issues or needs decisions.
- skip: If the PR should stay a draft.
- `/quest-delete`: If the quest should be deleted.

Also offer `/quest-plan` for its suggested follow-ups.
Include quest context, as many quests are concurrently in flight.

Run each selected `/quest-merge` or `/quest-iterate` in a background sub-agent with its own isolated worktree, as for `/quest-start`.
Run selected `/quest-plan` sessions in the foreground.

Once every sub-agent has finished, remove local worktrees and branches whose tip is the head of a merged PR; squash merges leave that tip off the base branch.
Leave the worktree you are running in and any holding uncommitted work; list those in your summary.
