---
description: Merge a quest once reviews and CI pass.
---

Before you begin, run `quest guide` and read its output completely.

Parse the arguments to determine the PR number, otherwise resolve it from the current context/branch.
If a draft, stop and offer `/quest-review` instead.
Take the PR with `quest merge <pr>` before acting, passing a token you already hold from another state to swap it, and keep the hold token it prints; `quest merge --help` explains holds.
If it refuses because another session holds the PR, stop and report what it printed; taking over a stale hold is the user's choice.
Release the hold with `quest release <pr> <token>` whenever you stop before successful queue submission or enabling auto-merge, including to ask. The hold is temporary ownership, not the user's merge decision.

Read one current snapshot of the PR's head, checks, merge state, reviews by head, and unresolved threads with `quest status <pr>`.
Fix any mechanical issues with the PR, such as merge conflicts and failing CI checks.
Address the review findings already posted on the head, fixing those you agree with and leaving a comment on any you disagree with.
Never wait for or request a review, including an `@codex review` comment or toggling a ready PR to draft and back.
Before pushing any change, review the new head locally, following the guide's Reviews section, including its design checkpoint across rounds.

Abort the merge if there is a significant decision to be made.
Interactively prompt the user with your recommendation and any alternatives.
Suggested follow-ups do not hold the merge; include them in the handoff for a later `/quest-plan` invocation.

A background agent that cannot prompt lists its decisions and suggested follow-ups in its report instead.

Complete the local fixes, checks, and review before publishing.
Do not wait for GitHub checks, online reviews, or merge-queue activity.
Submit the authorized landing to the queue when possible. If submission is refused pending a GitHub event, report the PR, head, pending condition, and the user's authorizing decision, release the hold, and terminate.
A later invocation or separate monitor can start a new attempt under that decision and acquire a new hold with `quest merge <pr>`. This workflow does not start a monitor or promise an automatic retry.

Merge the PR *only* after all outstanding decisions have been confirmed.
Before landing it, fetch the PR's base branch and head, check out the head, and run `quest --root <head-checkout> check --base <remote>/<base> --branch <head-branch>`.
Run a `quest` the PR cannot modify, such as an installed release or a build from the base, from a directory outside the head checkout: the head's files, including runtime config such as `bunfig.toml`, are untrusted.
A stale local base can predate the quest and skip the check.
On a finding, fix the branch: delete the finished quest with `quest rm`, or rewrite it to the remainder the PR body names.
Then push, re-check, and continue; ask the user only when what remains is unclear.
Land only a head named by a `## Review` record the guide counts, or one the guide's review exemptions cover.
Leave a summary of the changes and decisions made, then land the head you checked with `quest merge <pr> <token> --land <full 40-character head SHA>`.
It makes a merge commit; add `--squash` or `--rebase` when the repository's root instructions name that method for the PR's base.
On a base that requires the `quest land` check, it queues the PR for `quest land`, whose chain merges and tests against the current base; do not merge the base or rerun checks per PR just to queue it.
On an ungated base, the command refuses a head that does not contain the current base. Merge the base locally (never rebase), rerun the repository's checks, push, and land the new head after satisfying the guide's review rule for those changes.
The `quest:merge` label stays on while the PR is queued or auto-merging.
Report once it is landing, then terminate the agent; the queue re-checks it without you.
A PR that left the queue unmerged or lost auto-merge shows why under `landing-stopped` in `quest status <pr>`.
After `merge_conflict`, `failed_checks`, or `checks_pending`, the user's existing merge decision authorizes a later invocation or monitor to dispatch `/quest-merge` again without asking, once actionable. That attempt takes a new hold with `quest merge <pr>`; a spent label/token need not survive the ejection. The published agent has already terminated and does not observe or report that later event.
Any other reason, such as a person removing it, is the user's call, so report why instead of landing it again.
Never close a PR to unstick it, and never work around a refused merge; ask instead.
