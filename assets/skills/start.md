---
description: Start work on a quest.
---

Before you begin, run `quest guide` and read its output completely.

Your goal is to implement the quest, or as much of it as possible, and open a PR.
The argument is the quest to work on.

If you are unsure on the best course of action, ask the user for direction.

Update your checkout, run `quest ready`, then confirm the quest is still ready and unclaimed.
Check the forge for a live runner lock or an open change; on GitHub, check the quest's remote branch and open PRs.
Confirm you can write in your worktree; if you cannot, stop and report without claiming.
Claim it as `quest guide` describes.
Release work you cannot finish; on GitHub, delete its branch claim and your isolated worktree.

Implement the quest until it is complete, or some blocker is hit, then create a PR.
Never write to or clean up a directory other agents share, such as a session scratchpad.

When done, explain the result in a few lines and summarize any issues encountered.
Prompt the user interactively for any open decisions, including your recommendation.
Record the outcome as a PR comment as a paper-trail.

Also offer to `/quest-plan` any suggested follow-ups as a multi-select.

Once the quest is complete and the user has settled every decision, including choices you made without asking, and the PR reflects them, run `/quest-ready` on it.

A background agent that cannot prompt lists its decisions and suggested follow-ups in its report instead, running `/quest-ready` only when the quest is complete and it has none.
