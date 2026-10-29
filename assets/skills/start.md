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

Implement the quest until it is complete, or some blocker is hit. Finish the local checks and review before the final push and PR description update.

When done, explain the result in a few lines and summarize any issues encountered.
List choices you made without asking in the PR body rather than waiting on them.

Settle open decisions before the final publication: prompt the user interactively, including your recommendation, and record the answers in the PR description.
Once the quest is complete and no decision remains, run `/quest-review` once, then report the published result and terminate.

A background agent that cannot prompt lists its open decisions in its report instead, running `/quest-review` only when the quest is complete and no decision is left for the maintainer.

After the completed attempt is published, report its PR and terminate. GitHub monitoring belongs to a separate process.
