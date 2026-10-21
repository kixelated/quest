---
description: Start work on a quest.
---

Before you begin, run `quest guide` and read its output completely.

Your goal is to implement the quest, or as much of it as possible, and open a PR.
The argument is the quest to work on.

If you are unsure on the best course of action, ask the user for direction.

Confirm you can write in your worktree; if you cannot, stop and report without claiming.
Update your checkout and check the forge for a live runner lock, then claim the quest with `quest start <quest>`.
If it refuses, the quest is blocked or someone else holds it: report what it printed and stop.
If you cannot pursue a claim before pushing work, release it with `quest start --release <quest>` and remove your isolated worktree; once work is pushed, hand it back as the guide describes.

Implement the quest until it is complete, or some blocker is hit, then push to its PR and update the description.
Never write to or clean up a directory other agents share, such as a session scratchpad.

When done, explain the result in a few lines and summarize any issues encountered.
Prompt the user interactively for any open decisions, including your recommendation.
Record the outcome as a PR comment as a paper-trail.

Also offer to `/quest-plan` any suggested follow-ups as a multi-select.

Once the quest is complete and the user has settled every decision, including choices you made without asking, and the PR reflects them, run `/quest-ready` on it.

A background agent that cannot prompt lists its decisions and suggested follow-ups in its report instead, running `/quest-ready` only when the quest is complete and it has none.
