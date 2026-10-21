---
description: Mark a draft PR ready for review, wait for an automated review, then decide whether to merge.
---

Before you begin, run `quest guide` and `quest skill merge`, and read their output completely.

Parse the arguments to determine the PR number, otherwise resolve it from the current context/branch.
If its body lists open decisions or unfinished work, offer `/quest-iterate` first.

Flip a draft to "Ready for Review", then wait with `quest wait`, as `quest skill merge` describes, until an automated reviewer reviews or reacts.
Skip the wait only if the repository has no automated reviewer.

Summarize the reviews and CI from `quest status <pr>`, then interactively prompt the user with your recommendation:
- `/quest-merge`: If the reviews found no significant issues.
- `/quest-iterate`: If they raised significant issues or decisions.
- skip: If the PR should not be merged yet.
- `/quest-delete`: If the quest should be deleted.

Also offer `/quest-plan` for suggested follow-ups.
A background agent that cannot prompt lists these in its report instead.
