---
description: Mark a draft PR ready for review, wait for a review, then decide whether to merge or iterate.
---

Before you begin, run `quest guide` and `quest skill merge`, and read their output completely.

Parse the arguments to determine the PR number, otherwise resolve it from the current context/branch.
If its body still lists open decisions or unfinished work, ask whether to settle them with `/quest-iterate` first.

If a draft, flip it to "Ready for Review", which triggers CI and reviews.
Wait until at least one review is posted, with `quest wait` as `quest skill merge` describes.
Automated reviews count; optional reviewers do not, so never wait on them alone.

Summarize the review findings and CI status, then interactively prompt the user with your recommendation:
- `/quest-merge`: If the reviews found no significant issues.
- `/quest-iterate`: If the reviews raised significant issues or decisions.
- skip: If the PR should not be merged yet.
- `/quest-delete`: If the quest should be deleted.

Also offer `/quest-plan` for any suggested follow-ups.
A background agent that cannot prompt lists the findings and its recommendation in its report instead.

Never merge; continue with `/quest-merge` only once the user picks it.
