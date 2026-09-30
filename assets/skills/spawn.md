---
description: Start multiple quests in parallel.
---

Before you begin, run `quest guide` and read its output completely.

Your goal is to execute many quests in parallel.
The scope consists of all ready quests that are not claimed.
Use the argument (if provided) to filter to specific quests/questlines.
For a quest waiting on an outside condition, check whether it has cleared before recommending.

Interactively prompt the user with one question per quest, never grouping quests into one question (a prompt may hold a few questions), with your recommendation:
- `/quest-start`: If the quest is well planned with no blockers.
- `/quest-plan`: If the quest has significant design issues.
- skip: If the quest should not be started yet.
- deprioritize: If the quest should wait behind other work; `/quest-plan` moves it down.
- `/quest-delete`: If the quest should be deleted.

Include a brief summary of each quest.
Consider ordering, suggesting to skip any quests that would result in conflicts.

Spawn a background sub-agent for each `/quest-start` with its own isolated worktree, since agents cannot write to a worktree their parent created.
The agent switches it to the base `quest branch` prints (`git checkout -B <quest branch> origin/<base>`), creating the questline branch first if it is missing.

Each agent reports back only when done or blocked.
Limit the number of active agents to the physical CPU core count.
Other sessions share this machine: hold new agents while the load average exceeds the core count.

When done, each agent opens a draft PR.
Its report lists every open decision and suggested follow-up with a recommendation.
Report each sub-agent's final status, staying silent on interim notifications, but do not monitor their PRs.

As each agent reports, explain its result in a few lines, then interactively prompt the user.
Include quest context, as many quests are concurrently in flight.

Run any `/quest-plan` sessions in the foreground.
Start any asynchronous tasks first before blocking on user prompt.
Perform any research and monitoring in the background.
