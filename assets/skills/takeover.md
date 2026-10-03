---
description: Adopt someone else's open PR and drive it to landable.
---

Before you begin, run `quest guide` and read its output completely.

Someone else opened this PR; you are now responsible for it.
Parse the arguments to determine the PR number. Any other text is the user's feedback on the PR; interpret it against the diff.
If unsure about any course of action, prompt the user with your recommendation and any alternatives.

Read the PR, its linked issues and quest, the reviews and comments posted on it, and the surrounding code.
Judge the approach before touching anything: would you take a different one?
If you cannot push to the PR's branch, stop and report.

Fix mechanical issues, such as merge conflicts and failing CI checks.
Address the automated review findings already posted, without waiting on optional reviewers: fix those you agree with and comment on any you decline.
One round only; never request a review.

Push your changes to the PR, updating its summary if needed.
Summarize the changes made, and offer `/quest-plan` for any suggested follow-ups.
A background agent that cannot prompt lists its decisions and suggested follow-ups in its report instead.

Never merge; that is `/quest-merge`, once the user picks it.
