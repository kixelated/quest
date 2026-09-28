---
name: quest-complete
description: Complete quests in parallel.
---

Before starting, run `quest guide`, `quest skill merge`, and `quest skill plan`.

The goal is to evaluate the open (non-draft) PRs in the repository and decide which ones to merge.
The skill argument can be used to filter the PRs in scope.
Each merge is performed in parallel by a sub-agent.

Interactively prompt the user about every PR (batch a few PRs per prompt), with your recommendation:
- `/quest-merge`: Only have minor outstanding issues.
- `/quest-plan`: Have significant issues and need decisions.
- skip: Are not ready to be merged yet.
- `/quest-delete`: Should be deleted.

Include a brief summary of each PR.
Consider ordering, queuing any merges if they would result in conflicts.

Run each `/quest-merge` in its own sub-agent.
Limit the number of active agents to the CPU core count.
Other sessions share this machine: hold new agents while the load average exceeds the core count.

Keep going until all PRs have been decided then wait for all spawned sub-agents to finish.
Before finishing, refresh the open PR list and process any new PRs in scope.

As each sub-agent reports, include a summary and interactively prompt the user for any outstanding decisions.
Start any asynchronous tasks first before blocking on any prompt.
