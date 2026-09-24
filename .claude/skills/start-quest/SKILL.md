---
name: start-quest
description: Start work on a quest.
---

Before you begin, read `quest/AGENTS.md` completely.

Your goal is to implement the quest, or as much of it as possible, and create a PR.
The argument is the quest to work on.

If you are unsure on the best course of action, ask the user for direction.

Check readiness with `quest ready` and inspect existing branches and PRs.
Use an isolated worktree. `quest branch` names the branch and the bases it
merges through. Claim the quest as described in `quest/AGENTS.md` when remote
writes are authorized.
Implement the quest until it is complete, or some blocker is hit, then create a PR
against that base.
Summarize the notable changes for the user.
