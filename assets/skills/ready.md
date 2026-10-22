---
description: Mark a draft PR ready for review, wait for an automated review, then decide whether to merge.
---

Before you begin, run `quest guide` and `quest skill merge`, and read their output completely.

Parse the arguments to determine the PR number, otherwise resolve it from the current context/branch.
If its body lists open decisions or unfinished work, offer `/quest-iterate` first.

Take the PR with `quest ready <pr>` and keep the hold token it prints; `quest ready --help` explains holds.
If it refuses because another session holds the PR, stop and report what it printed; taking over a stale hold is the user's choice.
A draft you started in this session has no `## Decisions needed` section, so it is still yours and the command refuses it: mark it ready for review yourself, then take it.

Flip a draft to "Ready for Review" with `quest ready <pr> <token> --done`, which also drops its `## Decisions needed` section.
Then wait with `quest wait`, as `quest skill merge` describes, until an automated reviewer reviews or reacts.
Skip the wait only if the repository has no automated reviewer.

Summarize the reviews and CI from `quest status <pr>`, then interactively prompt the user with your recommendation:
- `/quest-merge`: If the reviews found no significant issues.
- `/quest-iterate`: If they raised significant issues or decisions.
- skip: If the PR should not be merged yet.
- `/quest-delete`: If the quest should be deleted.

Also offer `/quest-plan` for suggested follow-ups.
A background agent that cannot prompt lists these in its report instead.

Hand the PR back with `quest release <pr> <token>` before you ask or report.
To go straight on to `/quest-iterate` or `/quest-merge` in this session, pass the token to its command instead, which swaps the label.
