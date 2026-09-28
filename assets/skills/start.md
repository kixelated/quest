---
name: start
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
Prompt the user interactively for every open decision (naming, API shape, branch, blockers, manual steps), each with your recommendation, and offer follow-ups as a multi-select to /plan.
Keep the PR a draft until the user confirms every decision.
Then mark it ready and ask what to do with it: /merge (addressing any minor issues), skip, or /close, with your recommendation first and room for questions.
Record the outcome as a PR comment when it isn't already in the PR: each decision and its reason, and any follow-up the user declined.
A background agent that cannot prompt lists its decisions in its report instead and leaves the PR a draft.
