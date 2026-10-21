# [S] Check flags links to finished milestones

## Goal

A quest that requires a milestone (`/quest/mN/README.md`) stops being
blocked by it once that milestone is finished, and nobody has to remember to
remove the link by hand. Milestones are permanent, so today the link resolves
forever and the quest never becomes ready
([kixelated/quest#152](https://github.com/kixelated/quest/pull/152#discussion_r4317606198)).
/quest-recurring relies on this: to run at the end of mN, the gate requires
mN and the next run requires the gate.

Non-goals: ordinary epics and quests still clear by being deleted, and
milestone shifting and numbering are unchanged.

## Plan

Decided 2026-10-19 (user):

- A milestone is finished when its README has no `## Required` heading.
  Non-child blockers count, so moq-dev/moq's m1, which lists m0 quests, is not
  finished while those remain. A required epic's blockers already expand that
  way, and the test is still a grep of one file.
- `quest check` forces the removal; readiness stays syntactic. `ready()` and
  `blockers()` are unchanged, so "ready = no `## Required` heading" still holds
  for the CLI, the Kix board, the GitHub service, and anything that greps.
  Rejected: having `ready()` count the link as cleared, which breaks the grep
  and leaves the stale link standing, and doing both, which gives two sources
  of truth that disagree until someone tidies up.
- Add a rule in `src/core/rules.ts`: a `Required` entry whose target is a
  permanent README other than the root, and whose target has no `## Required`,
  is a finding at the entry's line. The message names the finished milestone
  and says to remove the link, and the heading with its last entry. Exempt the
  structural entry: the root's own listing of its milestones is membership,
  not a blocker. The finding cascades on its own: removing the last link
  leaves a quest with no heading, which is ready.
- The PR that empties a milestone picks up these edits, the same way a
  finished quest's PR already removes the links to it. Two PRs racing (one
  adds a link while the other empties the milestone) can leave main failing
  check until one of them is fixed; accepted, like other merge conflicts.
- No line in `assets/AGENTS.md`; the check message carries the rule. Update
  the README's "When a quest is complete, its PR removes ... the links that
  depended on it" to say that a PR finishing a milestone removes the links to
  that milestone too.
- moq-dev/moq needs nothing. It pins quest at ea9c25d in `flake.nix` and picks
  this up with its next routine bump. Every moq milestone still has a
  `Required`, so the bump trips nothing. Four moq quests require
  `/quest/m1/README.md` (the release cut, the API-diff check, the API shape
  review, and the feature review); the PR that finishes m1 removes those links.
- `quest rm` ([move and delete quests](/quest/m0/helpers/move.md)) drops these
  links as well; whichever of the two quests lands second wires that up.

Tests: a quest requiring a finished milestone is flagged; one requiring a
milestone with only non-child blockers left is not; the root's milestone
listing is not; and a fixed tree passes.

## Related

- [Move and delete quests](/quest/m0/helpers/move.md) - `quest rm` drops links to milestones it leaves finished
