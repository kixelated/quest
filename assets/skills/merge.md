---
description: Merge a quest once reviews and CI pass.
---

Before you begin, run `quest guide` and read its output completely.

Parse the arguments to determine the PR number, otherwise resolve it from the current context/branch.
If a draft, flip it to "Ready for Review".

Fix any mechanical issues with the PR, such as merge conflicts and failing CI checks.
Address any review findings, fixing those you agree with and leaving a comment on any you disagree with.

Abort the merge if there is a significant decision to be made.
Interactively prompt the user with your recommendation and any alternatives.
This includes deciding if we should `/quest-plan` for suggested follow-ups.

A background agent that cannot prompt lists its decisions and suggested follow-ups in its report instead.

Merge the PR *only* after all outstanding decisions have been confirmed.
Leave a summary of the changes and decisions made and enable auto-merge with the full 40-character head SHA.
Never close a PR to unstick it, and never work around a refused merge; ask instead.
