# Agent workflow helpers

## Goal

Agents stop hand-writing `gh`, `jq`, and `sed` loops for routine quest
workflow steps, because `quest` commands cover them and the skills point at
those commands: CI results while waiting, a one-shot PR status, claiming
quests and PRs, moving and deleting quests, and unattended triage.

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
- Decided 2026-10-20 (user), from a wider audit of Claude Code and Codex
  sessions: claims and PR ownership live on GitHub as a draft PR per claimed
  quest and one `quest:*` state label per owned PR, replacing the planned
  `quest claim`. The named gate lock is dropped: it replaced moq.pro's mkdir
  merge mutex, which
  [moq-dev/moq.pro#2510](https://github.com/moq-dev/moq.pro/pull/2510)
  replaced with a label queue, and PR ownership covers the remaining
  collisions.
- Decided 2026-10-21 (user): no `quest:start` label; a draft belongs to its
  starter until its body has a `## Decisions needed` section, which the guide
  defines as the hand-back marker. Commands read only whether it is present.
  This narrows the 2026-10-19 decision above: `quest status` still does not
  parse the decisions listed in a PR body. It also amends the 2026-10-20
  decision: a PR is owned while it carries a `quest:*` label or is a draft
  without that section.
- Decided (user): this epic ranks after the worktree and gate quests and
  before the Kix decision UI. Children rank by sessions affected.

## Required

- [PR status](/quest/m0/helpers/status.md) - one call for head, checks, merge state, reviews by head, and unresolved threads
- [Move and delete quests](/quest/m0/helpers/move.md) - `quest mv` and `quest rm` keep every root-absolute link valid
- [CI checks in wait](/quest/m0/helpers/wait-checks.md) - `quest wait` wakes on required check results for the head
- [quest start](/quest/m0/helpers/start.md) - claim a quest with a draft PR, the `## Decisions needed` hand-back, `quest unblocked --unclaimed`, and CI on ready PRs only
- [PR state commands](/quest/m0/helpers/pr-states.md) - `quest iterate`, `ready`, `merge`, and `release` label the one owner of a PR
- [Headless agents](/quest/m0/helpers/headless-agents.md) - `/quest-spawn api` launches, resumes, and stops billed agents through one command auto mode allows

## Related

- [Expensive command gate](/quest/m0/local-gate.md) - CPU admission for the checks these helpers wrap
- [Agent lifecycle integration](/quest/m0/worktree-agents.md) - removes the agent-level load-average rules
