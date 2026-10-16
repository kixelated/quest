---
description: Merge a quest once reviews and CI pass.
---

Before you begin, run `quest guide` and read its output completely.

Parse the arguments to determine the PR number, otherwise resolve it from the current context/branch.
If a draft, stop and offer `/quest-ready` instead.

Fix any mechanical issues with the PR, such as merge conflicts and failing CI checks.
Address any review findings, fixing those you agree with and leaving a comment on any you disagree with.

Abort the merge if there is a significant decision to be made.
Interactively prompt the user with your recommendation and any alternatives.
This includes deciding if we should `/quest-plan` for suggested follow-ups.

A background agent that cannot prompt lists its decisions and suggested follow-ups in its report instead.

When waiting for a required review or for an enabled auto-merge to finish, run
`quest wait <pr> --timeout 3300` as one blocking command instead of polling
GitHub in a loop. Inspect the events and decide whether they satisfy the wait;
the command does not decide whose review counts. If activity is irrelevant
(including bot notices), call it again with `--since` set to the last field of
its last line. Exit 3 means the deadline passed with no activity; run the same
command again. Other failures must be reported rather than treated as activity.
Check CI with its own blocking check watcher, bounded under an hour the same
way; check runs are not PR timeline activity. Bounding each wait under an hour
keeps a long wait from outliving the agent's prompt cache. Do not wait for
optional reviews.

Merge the PR *only* after all outstanding decisions have been confirmed.
Leave a summary of the changes and decisions made and enable auto-merge with the full 40-character head SHA.
Never close a PR to unstick it, and never work around a refused merge; ask instead.
