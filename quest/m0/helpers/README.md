# Agent workflow helpers

## Goal

Agents stop hand-writing `gh`, `jq`, and `sed` loops for routine quest
workflow steps, because `quest` commands cover them and the skills point at
those commands: CI results while waiting, a one-shot PR status, claims, moving
and deleting quests, serialized check-then-merge, and unattended triage.

Only generic helpers belong here. Non-goals: the kix.quest UI, a daemon, and
deciding whose review or which result counts; the agent still decides.

## Plan

Decided 2026-10-19 from an audit of Claude Code transcripts in moq-dev/moq and
moq-dev/moq.pro: 396 sessions from Oct 17-19, 2026, plus about 339k Bash
commands from Sep-Oct. Session counts in each child come from that window.

- Decided (user): plan only the really generic helpers. Replying to and
  resolving review threads (103 and 68 sessions) is dropped: its attribution
  footer and wording are user and repository policy, and `gh api` already
  does the call. Parsing open decisions from a PR body is dropped from
  `quest status`, since that body format is a skill convention.
- GitHub calls live in `src/cli/` beside `quest wait`, outside the
  forge-agnostic core. Pure tree edits, such as link rewriting, go in the
  core. The first child to add a second GitHub caller extracts the client in
  `src/cli/wait.ts` (auth, rate-limit retry, same-origin pagination) instead
  of copying it.
- Decided (user): no separate documentation page. Each child updates
  `--help`, README examples, and the skill prose it replaces; the user asked
  for those skill edits through this plan.
- Decided (user): this epic ranks after the worktree and gate quests and
  before the Kix decision UI. Children rank by sessions affected.

## Required

- [PR status](/quest/m0/helpers/status.md) - one call for head, checks, merge state, reviews by head, and unresolved threads
- [Move and delete quests](/quest/m0/helpers/move.md) - `quest mv` and `quest rm` keep every root-absolute link valid
- [CI checks in wait](/quest/m0/helpers/wait-checks.md) - `quest wait` wakes on required check results for the head
- [Claim quests](/quest/m0/helpers/claim.md) - `quest claim`, `--release`, and `quest unblocked --unclaimed`
- [Named gate lock](/quest/m0/helpers/gate-lock.md) - `quest gate --lock <name>` serializes check-then-merge
- [Unattended triage](/quest/m0/helpers/afk.md) - an `afk` argument that only asks about merges and deletes
- [Headless agents](/quest/m0/helpers/headless-agents.md) - `/quest-spawn api` launches, resumes, and stops billed agents through one command auto mode allows

## Related

- [Expensive command gate](/quest/m0/local-gate.md) - the gate the lock builds on
- [Agent lifecycle integration](/quest/m0/worktree-agents.md) - removes the agent-level load-average rules
