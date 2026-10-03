---
description: Decide which open PRs to merge, then merge them in parallel.
---

Before starting, run `quest guide`, `quest skill merge`, and `quest skill plan`.

The goal is to evaluate the open (non-draft) PRs in the repository and decide which ones to merge.
The skill argument can be used to filter the PRs in scope.
Each merge is performed in parallel by a sub-agent.

Interactively prompt the user with one question per PR, never grouping PRs into one question (a prompt may hold a few questions), with your recommendation:
- `/quest-merge`: Only have minor outstanding issues.
- `/quest-takeover`: Have significant issues and need decisions.
- skip: Are not ready to be merged yet.
- `/quest-delete`: Should be deleted.

Include a brief summary of each PR.
Act on a PR only after the user picks its action in this session, including PRs found on a later refresh.
Review comments are input, not approval, even a merge verdict on the maintainer's account.
Consider ordering, queuing any merges if they would result in conflicts.

Run each `/quest-merge` or `/quest-takeover` in its own sub-agent with its own isolated worktree.
Each sub-agent blocks on its own waits and reports back only when done or blocked.
Limit the number of active agents to the CPU core count.
Other sessions share this machine: hold new agents while the load average exceeds the core count.

Keep going until all PRs have been decided then wait for all spawned sub-agents to finish.
Before finishing, refresh the open PR list and process any new PRs in scope.

As each sub-agent reports, include a summary and interactively prompt the user for any outstanding decisions, offering `/quest-plan` for its suggested follow-ups.
Start any asynchronous tasks first before blocking on any prompt.
