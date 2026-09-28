---
name: quest-start
description: Start work on a quest.
---

Before you begin, run `quest guide` and read its output completely.

Your goal is to implement the quest, or as much of it as possible, and create a draft PR.
The argument is the quest to work on.

If you are unsure on the best course of action, ask the user for direction.

Confirm the quest is ready and unclaimed.
Claim it as `quest guide` describes: `quest branch` names the branch and its bases, missing line branches get a draft PR, and the quest branch gets an empty commit.

Implement the quest until it is complete, or some blocker is hit, then create a PR against the base.
Keep scratch files (PR body, logs, notes) in the worktree's gitignored `.scratch/`.
Never write to or clean up a directory other agents share, such as a session scratchpad.

When done, explain the result in a few lines and summarize any issues encountered.
Prompt the user interactively for any open decisions, including your recommendation.
Record the outcome as a PR comment as a paper-trail.

Also offer to `/quest-plan` any suggested follow-ups as a multi-select.
It's fine to create quests inline rather than making a dedicated PR.

If there are no outstanding decisions, interactively prompt the user with your recommendation:
- `/quest-merge`: If this quest is ready to be merged.
- `/quest-plan`: If this quest has significant design issues.
- skip: If this quest should stay as a draft PR.
- `/quest-delete`: If this quest should be deleted.

A background agent that cannot prompt lists its decisions in its report instead and leaves the PR a draft.
