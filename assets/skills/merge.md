---
description: Merge a quest once reviews and CI pass.
---

Before you begin, run `quest guide` and read its output completely.

Parse the arguments to determine the PR number, otherwise resolve it from the current context/branch.
If a draft, stop and offer `/quest-review` instead.
Take the PR with `quest merge <pr>` before acting, passing a token you already hold from another state to swap it, and keep the hold token it prints; `quest merge --help` explains holds.
If it refuses because another session holds the PR, stop and report what it printed; taking over a stale hold is the user's choice.
Hand it back with `quest release <pr> <token>` whenever you stop before it lands, including to ask.

Read the PR's head, checks, merge state, reviews by head, and unresolved threads with `quest status <pr>`, including after each `quest wait` wakes, instead of chaining `gh` queries.
Fix any mechanical issues with the PR, such as merge conflicts and failing CI checks.
Address the review findings already posted on the head, fixing those you agree with and leaving a comment on any you disagree with.
Never wait for or request a review, including an `@codex review` comment or toggling a ready PR to draft and back.
Before pushing any change, review the new head locally, following the guide's Reviews section, including its design checkpoint across rounds.

Abort the merge if there is a significant decision to be made.
Interactively prompt the user with your recommendation and any alternatives.
Suggested follow-ups do not hold the merge; once the PR merges, run `/quest-plan` on them without asking first.

A background agent that cannot prompt lists its decisions and suggested follow-ups in its report instead.

When waiting for CI, run
`quest wait <pr> --timeout 3300` as one blocking command instead of polling
GitHub in a loop; it also reports the head's required checks as `checks:failed`
or `checks:passed`, so no separate check watcher is needed.
Inspect the events and decide whether they satisfy the wait. If activity is
irrelevant (including bot notices and reviews), call it again with `--since`
set to the last field of its last line. Exit 3 means the deadline passed with
no activity; re-run with `--since` set to the printed cursor, so nothing during
the first wait is missed.
Other failures must be reported rather than treated as activity.
Run each wait so its exit wakes you, such as a background task that notifies on
exit, and end your turn until then. Never poll its output or rerun it under a
foreground time limit; each wake rereads your whole context. The hour bound
keeps that reread cached; a wake after the prompt cache expires rewrites it all.
A headless process ends when its turn ends, killing its background commands:
run each wait in the foreground instead, bounded by the shell's own time limit,
and apply the timeout rule above.

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
The `quest:merge` label stays on while the PR is queued or auto-merging, and after it leaves the queue unmerged, as the user's pick: `quest status` then shows it as `pick`, and `quest merge <pr>` takes it over with a new token.
Report once it is landing; do not wait for it to merge, since the queue re-checks it without you.
A PR that left the queue unmerged or lost auto-merge shows why under `landing-stopped` in `quest status <pr>`.
After `merge_conflict` or `failed_checks`, the pick still holds: fix it and land it again.
After `checks_pending`, wait for its required checks to pass and land it again.
Any other reason, such as a person removing it, is the user's call, so report why instead of landing it again.
Never close a PR to unstick it, and never work around a refused merge; ask instead.
