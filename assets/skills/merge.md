---
description: Merge a quest once reviews and CI pass.
---

Before you begin, run `quest guide` and read its output completely.

Parse the arguments to determine the PR number, otherwise resolve it from the current context/branch.
If a draft, stop and offer `/quest-ready` instead.

Read the PR's head, checks, merge state, reviews by head, and unresolved threads with `quest status <pr>`, including after each `quest wait` wakes, instead of chaining `gh` queries.
Fix any mechanical issues with the PR, such as merge conflicts and failing CI checks.
Address any review findings, fixing those you agree with and leaving a comment on any you disagree with.
Automated reviewers often find something new on every push, so keep fixing their findings without asking, but checkpoint the design.
Every fourth review round since the PR's last design change (one that reshapes the approach; fixing a finding is not one), stop before the next fix and reconsider the design: is something fundamentally wrong with the approach?
Report that judgment and what remains unresolved, recommending to continue, rethink the approach, merge as is, or drop the PR, and let the user decide.
Never request a review, including by toggling a ready PR to draft and back.

Abort the merge if there is a significant decision to be made.
Interactively prompt the user with your recommendation and any alternatives.
This includes deciding if we should `/quest-plan` for suggested follow-ups.

A background agent that cannot prompt lists its decisions and suggested follow-ups in its report instead.

When waiting for CI, a required review, or an enabled auto-merge to finish, run
`quest wait <pr> --timeout 3300` as one blocking command instead of polling
GitHub in a loop; it also reports the head's required checks as `checks:failed`
or `checks:passed`, so no separate check watcher is needed.
Inspect the events and decide whether they satisfy the wait;
the command does not decide whose review counts. If activity is irrelevant
(including bot notices), call it again with `--since` set to the last field of
its last line. Exit 3 means the deadline passed with no activity; re-run with
`--since` set to the printed cursor, so nothing during the first wait is missed.
Other failures must be reported rather than treated as activity.
Do not wait for optional reviews.
Run each wait so its exit wakes you, such as a background task that notifies on
exit, and end your turn until then. Never poll its output or rerun it under a
foreground time limit; each wake rereads your whole context. The hour bound
keeps that reread cached; a wake after the prompt cache expires rewrites it all.
A headless process ends when its turn ends, killing its background commands:
run each wait in the foreground instead, bounded by the shell's own time limit,
and re-run it with `--since` until it returns activity.

Merge the PR *only* after all outstanding decisions have been confirmed.
Leave a summary of the changes and decisions made and enable auto-merge with the full 40-character head SHA.
If your caller said it watches the merge queue, report once auto-merge is enabled.
Otherwise wait until the PR merges. If it leaves the queue unmerged or auto-merge
is disabled, confirm with `quest status <pr>`, then report why instead of
enabling auto-merge again; a new head needs the user's approval.
Never close a PR to unstick it, and never work around a refused merge; ask instead.
