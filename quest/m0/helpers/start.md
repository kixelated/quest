# [M] Claim a quest with a draft PR through quest start

## Goal

`quest start <quest>` claims a ready quest by pushing its empty claim commit
and immediately opening a draft PR, so every claim is visible on GitHub. `quest unblocked --unclaimed` lists ready quests nobody
holds, and `quest unblocked <path>` takes over printing what blocks one quest
from `quest ready`. Agents stop running `git ls-remote origin
'refs/heads/quest/...'` and `gh pr list --head/--search` by hand before
starting or spawning (105 of 396 sessions), and two sessions never implement
the same quest.

## Plan

Decided 2026-10-20 (user) from an audit of Claude Code and Codex transcripts
(566 and 465 sessions, Sep 22-Oct 21). This replaces the planned
`quest claim` quest. Every collision in that audit was two sessions owning
one PR or branch ("Another session force-pushed over my agent", "reverting
each other"); none came from two quests touching the same files.

- Decided (user): one owner per quest or PR, recorded on GitHub. A kix
  lease service with release on disconnect was weighed and dropped as more
  machinery than the problem needs; GitHub timestamps already say who came
  first and who went quiet.
- Decided (user): the draft PR is the claim. `quest start` pushes an empty
  claim commit with the explicit refspec
  `refs/heads/<branch>:refs/heads/<branch>`, never forcing, then opens a
  draft PR from it. A rejected push means someone else
  holds the branch. Give each claim commit a random nonce, so two claimers on
  the same base, identity, and second never build the same commit and both
  see success. Distinct exit codes separate "taken" from a failure.
- Contributors without push access open the draft PR from their fork. A
  collision is any open PR whose head branch is the quest's branch, from any
  repository; the earliest `createdAt` wins and later claimers stop.
- Decided 2026-10-21 (user): there is no `quest:start` label. A draft PR
  on a quest branch belongs to its starter, so fork contributors, whose
  tokens usually cannot label base-repository PRs, claim the same way as
  everyone else.
- Decided (user): a starter that hands back with decisions or unfinished
  work left keeps the PR a draft and adds a `## Decisions needed` section to
  its body. Otherwise it marks the PR ready. The guide defines that heading
  as the hand-back marker; tools read only whether it is present, never its
  contents. So:
  - a draft without the heading and with no `quest:*` label is still its
    starter's;
  - a draft with the heading, or a ready PR, with no `quest:*` label is
    idle and waits on the maintainer;
  - the [PR state commands](/quest/m0/helpers/pr-states.md) label a PR
    whenever another session takes it.
- A draft without the heading that looks stale is offered to the user for
  takeover, showing how long ago its last push or comment was. The user
  judges; there is no fixed timeout.
- `quest start --release <quest>` closes the draft PR and deletes the claim
  branch only while its tip is still the empty claim commit, using a lease on
  that SHA; otherwise it refuses and says why.
- Decided (user): CI runs on ready PRs only, so placeholder drafts cost
  nothing. GitHub supports this with `ready_for_review` in the
  `pull_request` types and a `github.event.pull_request.draft == false` job
  condition. Recommend that pattern in the guide and `SETUP.md`, and adopt it
  in this repository's `.github/workflows/check.yml`. Agents rely on local
  checks while in draft. Switching moq-dev/moq and moq-dev/moq.pro is
  follow-up work in those repositories.
- Decided (user): free the `ready` name for the PR state by moving
  `quest ready [path]` into `quest unblocked [path]`, which prints what
  blocks one quest. This breaks the v0.1.0 `quest ready`; update every use in
  the guide, skills, README, `SETUP.md`, and the kix Worker in the same PR.
- `quest unblocked --unclaimed` uses one `ls-remote` for `refs/heads/quest/*`
  and one query for open PRs, and prints skipped claims on stderr with their
  age and PR, so stale claims can be offered for takeover.
- The branch check is plain git. Only the PR steps are GitHub-specific; with
  a non-GitHub origin, open no PR and warn. Default the remote to origin,
  with `--remote` to override. kix.quest jobs claim the same way through its
  bot, so they count as claims here too.
- Update the guide's Execution section ("When a quest is complete, create a
  draft PR" becomes "open it when claiming", plus the hand-back rule), and the `start` and `spawn`
  skill prose to use these commands. The user asked for those edits through
  this plan.
- Test claiming free and taken quests, a race between two claimers, a fork
  PR that claims first, releasing a claim, refusing to release a branch with
  work on it, a hand-back with and without `## Decisions needed`, and the
  filtered ranking.
