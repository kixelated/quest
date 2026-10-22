---
description: Iterate on an open PR to settle its open decisions, fix CI and review findings, and push.
---

Before you begin, run `quest guide` and `quest skill plan`, and read their output completely.

You own this PR until it is landable.
Parse the arguments to determine the PR number. Any other text is the user's feedback on the PR; interpret it against the diff.
Take it with `quest iterate <pr>` before acting, and keep the hold token it prints; `quest iterate --help` explains holds.
If it refuses because another session holds the PR, stop and report what it printed; taking over a stale hold is the user's choice.
If you cannot push to the PR's branch, stop and report.

Read the PR, its linked issues and quest, the reviews and comments posted on it, and the surrounding code.
`quest status <pr>` reports its checks, reviews by head, and unresolved threads in one call.
Judge the approach before touching anything: would you take a different one?

Scope the changes this PR needs with the plan skill's interview, starting from the user's feedback, your judgment of the approach, and any review findings that need a decision.
Skip its quest and PR steps: record the settled decisions in this PR's description as the paper trail, then implement them immediately.
A sub-agent that cannot prompt picks the recommended option only for decisions the repository's instructions don't reserve for the maintainer, and lists those choices in the PR description and its report.
Reserved decisions, and any truly consequential choice, stay open in the PR with a recommendation.

Fix merge conflicts and failing CI checks.
Address the automated review findings already posted, without waiting on optional reviewers: fix those you agree with and comment on any you decline.
One round only; never request a review, including by toggling a ready PR to draft and back.

Push your changes to the PR and update its summary.
Summarize the changes made.

Mark the PR ready with `quest ready <pr> <token> --done` once nothing is unfinished and no decisions need the user.
Hand it back with `quest release <pr> <token>`, using the latest token printed, whenever you stop, including to ask.
Never merge; that is `/quest-merge`, once the user picks it.
