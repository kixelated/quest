# [S] A quest's PR leaves its quest accurate

## Goal

A PR merged from a quest's branch leaves the tree accurate: a PR that
finishes its quest deletes the file and every link to it, and a PR that
leaves work rewrites the quest to that remainder instead of noting it only
in the PR body. Merging refuses a quest-branch PR that does neither.

In moq-dev/moq on 2026-10-20, the `audit-quests` run found quests left
behind by merged PRs from their own branches. Three finished their quest
without deleting it ([moq-dev/moq#5926](https://github.com/moq-dev/moq/pull/5926),
[#5992](https://github.com/moq-dev/moq/pull/5992),
[#5993](https://github.com/moq-dev/moq/pull/5993)). Three partial drafts
merged through `/quest-complete` with the remainder written only in the PR
body ([#5989](https://github.com/moq-dev/moq/pull/5989),
[#5991](https://github.com/moq-dev/moq/pull/5991),
[#6006](https://github.com/moq-dev/moq/pull/6006)). Stale quests then rank as
ready work and get picked up again. No skill step deletes or trims the quest,
and `merge` enables auto-merge without looking at the file.

Non-goals: judging whether a rewrite is a faithful remainder (the agent and
reviewers still do), and PRs not on a quest branch, such as a contributor's
fork branch that implements a quest; those skip the guard. Merges that
bypass the merge skill, such as a maintainer's click on GitHub or in the
[decision inbox](/quest/m0/kix/merge.md), are guarded only where the
repository runs the guard as a required check; the hosted service has no
checkout to diff.

## Plan

Decided 2026-10-20 (user, planned from moq-dev/moq):

- One quest: the guide rule and the mechanical guard land together.
- State the rule once, in `assets/AGENTS.md`'s Execution section next to the
  existing "When a quest is complete" paragraph: the PR that finishes a quest
  deletes its file and every link to it, and a PR that leaves work rewrites
  the quest to what remains. The other skills already read the guide, so they
  don't repeat it. Update `README.md`'s matching sentence if it disagrees.
  Rejected: repeating the rule in start, iterate, ready, merge, and complete.
- Guard: `quest check --base <ref>`. When the head branch is a quest branch
  (`quest/<path>`, the quest's path without `.md`), the diff from the merge
  base of `<ref>` must delete or modify that quest file (`quest/<path>.md`, or
  `quest/<path>/README.md` for an epic); otherwise it is a finding naming the
  quest and the rule. A head branch that is not a quest branch, or names no
  existing quest at the base, adds no finding. The head defaults to the
  current branch; `--branch <name>` overrides it, because agents often push a
  differently named local branch to the quest branch with an explicit
  refspec. A plain `quest check` is unchanged. The diff needs git, not a
  forge, so it lives in `src/cli/` beside the other git callers and keeps
  `src/core` free of it. Rejected: a CI action alone (skills would run
  nothing locally), and a skill step alone with no code.
- A modified file passes even if the edit does not trim the quest (a link
  fix, say). Accepted: the guard is a floor against forgetting, not a review.
- `assets/skills/merge.md` fetches the PR's base and head, then runs
  `quest check --base <remote>/<base> --branch <head>` on a checkout of the
  PR head before enabling auto-merge. A stale or missing local base branch
  would put the merge base before the quest existed and skip it. On a
  finding, it fixes the branch: delete the quest and its links, or rewrite it
  to the remainder the PR body names, then push, re-check, and continue. It
  asks the user only when what remains is unclear. `/quest-complete` and
  `/quest-ready` reach merging through the merge skill, so they need no change
  of their own. Rejected: refusing and reporting for `/quest-iterate`.
- Repositories may also run the guard in CI on pull requests; document the
  invocation in `README.md`, but don't ship a workflow.
- [Move and delete quests](/quest/m0/helpers/move.md) gives `quest rm`, which
  the fix-up step uses once it lands; until then the agent deletes and
  unlinks by hand.

Tests: a quest-branch diff that deletes the quest, one that edits it, and one
that leaves it untouched (the finding); an epic branch checked against its
README; a non-quest branch; a branch naming a quest that does not exist at
the base; and `--branch` overriding the current branch.

## Related

- [Move and delete quests](/quest/m0/helpers/move.md) - `quest rm` deletes a quest and every link to it
- [Finished milestone links](/quest/m0/milestone-links.md) - the same "a finishing PR removes what depended on it" rule for milestones
