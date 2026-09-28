---
name: quest-spawn-merge
description: Decide and merge GitHub PRs in parallel.
---

Before starting, read `quest skill merge`, `quest skill takeover`, and `quest skill close`.
The skill argument can be used to filter the PRs in scope.

The goal is to evaluate the open PRs in the repository and decide which ones to merge.
Each merge is performed in parallel by a sub-agent.

Recommend an action for every PR: /quest-merge (addressing any minor issues), skip, or /quest-close.
Start /quest-merge right away for PRs you'd merge with no open question.
Interactively prompt the user about the rest, a few PRs per prompt, with your recommendation first and room for questions.

Run each /quest-merge or /quest-close in its own sub-agent.
Merges mostly wait on GitHub, so there is no fixed cap; other sessions share this machine, so hold new agents while the load average exceeds the core count.
Each sub-agent blocks on its own waits and reports back only when done or blocked.

Keep going until all PRs have been decided then wait for all spawned sub-agents to finish.
Before finishing, refresh the open PR list and process any new PRs in scope.

As each sub-agent reports, explain its result in a few lines and prompt the user inline without waiting for the rest: each open decision with the PR and your recommendation, then its follow-ups as a multi-select.
Record the outcome as a PR comment when it isn't already in the PR: each decision and its reason, and any follow-up the user declined.
Summarize the results when done, including the issues encountered.
