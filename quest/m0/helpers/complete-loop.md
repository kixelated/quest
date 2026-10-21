# [S] Keep /quest-complete current across rounds

## Goal

`/quest-complete` notices new PRs as they appear, keeps the user's picks and
holds for the whole session, and counts review rounds per PR rather than per
sub-agent. The maintainer stops asking "any new PRs?" (8+ times in a month of
moq transcripts) and stops re-stating holds and merge approvals.

## Plan

Decided 2026-10-21 (user), from that audit. The user asked for these skill
edits through this plan.

- Re-scan the open PR list whenever a sub-agent reports or a merge wait
  wakes, not only before finishing, and ask about new PRs in scope the same
  way.
- An "accept all" or "use your recommendations" answer never covers a
  merge; each merge needs its own pick. A skip or hold stands across refreshes
  and re-dispatched sub-agents until the user lifts it.
- Fresh sub-agents count review rounds from zero, so the merge skill's design
  checkpoint never fires across re-dispatches. Count rounds from the PR's
  timeline since its last design change, and apply the same checkpoint in
  `iterate`, which has none today. Record a design change somewhere the next
  agent can read it back from the PR, such as the comment recording the
  decision.

## Related

- [PR state commands](/quest/m0/helpers/pr-states.md) - also rewrites how `complete` dispatches and skips held PRs
- [Unattended work](/quest/m0/helpers/afk.md) - carries on picks the user already made
