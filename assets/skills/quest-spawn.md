---
name: quest-spawn
description: Start multiple quests in parallel.
---

Before you begin, run `quest guide` and read its output completely.

Your goal is to execute many quests in parallel.
The scope consists of all ready quests that are not claimed.
Use the argument (if provided) to filter to specific quests/questlines.
Inspect any blocked quests and determine if they can be unblocked.

Interactively prompt the user about every PR (batch a few), with your recommendation:
- `/quest-start`: If the quest is well planned with no blockers.
- `/quest-plan`: If the quest has significant design issues.
- skip: If the quest should not be started yet.
- `/quest-delete`: If the quest should be deleted.

Include a brief summary of each PR.
Consider ordering, suggesting to skip any quests that would result in conflicts.

Spawn a background sub-agent for each `/quest-start`.
Create a fresh worktree on the base `quest branch` prints, creating the questline branch first if it is missing.

Each agent reports back only when done or blocked.
Limit the number of active agents to the physical CPU core count.
Other sessions share this machine: hold new agents while the load average exceeds the core count.

Each agent switches into its own worktree and when done, opens a draft PR.
Its report lists every open decision with a recommendation.
Report each sub-agent's final status, staying silent on interim notifications, but do not monitor their PRs.

As each agent reports, explain its result in a few lines, then interactively prompt the user.
Run any `/quest-plan` sessions in the foreground.
Start any asynchronous tasks first before blocking on user prompt.
Perform any research and monitoring in the background.
