---
description: Adopt someone else's open PR and drive it to landable.
---

Before you begin, run `quest guide` and `quest skill plan`, and read their output completely.

Someone else opened this PR; you are now responsible for it.
Parse the arguments to determine the PR number. Any other text is the user's feedback on the PR; interpret it against the diff.
If you cannot push to the PR's branch, stop and report.

Read the PR, its linked issues and quest, the reviews and comments posted on it, and the surrounding code.
Judge the approach before touching anything: would you take a different one?

Scope the changes this PR needs with the plan skill's interview, starting from the user's feedback, your judgment of the approach, and any review findings that need a decision.
Skip its quest and PR steps: record the settled decisions in this PR's description as the paper trail, then implement them immediately.
A sub-agent that cannot prompt picks the recommended option for each decision and lists those decisions in the PR description and its report.
It stops to ask only when a choice is truly consequential.

Fix merge conflicts and failing CI checks.
Address the automated review findings already posted, without waiting on optional reviewers: fix those you agree with and comment on any you decline.
One round only; never request a review.

Push your changes to the PR and update its summary.
Summarize the changes made, and offer `/quest-plan` for follow-ups that belong outside this PR.

Never merge; that is `/quest-merge`, once the user picks it.
