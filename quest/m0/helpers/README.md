# Agent workflow helpers

## Goal

Agents stop hand-writing `gh`, `jq`, and `sed` loops for routine quest
workflow steps, because `quest` commands cover them and the skills point at
those commands: CI results while waiting, a one-shot PR status, claiming
quests and PRs, moving and deleting quests, and unattended work. Skill
rules that remove the maintainer's repeated steering belong here too.

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
  core. GitHub commands share the client in `src/cli/github.ts` (auth,
  rate-limit retry, same-origin pagination, GraphQL) instead of copying it.
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
- Decided 2026-10-21 (user), from a month of moq maintainer transcripts:
  quests that remove the maintainer's repeated steering join this epic.
  `/quest-afk` and the guide rules rank first, since they save the most
  maintainer time and change only prose. The complete loop ranks right after
  the PR state commands, which also rewrite `complete`. Findings that fit an
  existing child went into it: the merge method and the merged-PR refusal
  into [PR state commands](/quest/m0/helpers/pr-states.md). Ready at
  hand-back went into [Guide rules](/quest/m0/helpers/guide-rules.md), since
  quest start landed without it.

## Required

- [Unattended work](/quest/m0/helpers/afk.md) - `/quest-afk` replaces the `afk` argument: it skips every decision and keeps starting agreed work; every skill ends with a summary
- [Guide rules](/quest/m0/helpers/guide-rules.md) - pushing, briefs, ready at hand-back, follow-ups, whose review counts, and user-owned choices
- [PR state commands](/quest/m0/helpers/pr-states.md) - `quest iterate`, `ready`, `merge`, and `release` label the one owner of a PR
- [Complete loop](/quest/m0/helpers/complete-loop.md) - `/quest-complete` re-scans PRs, keeps picks and holds, and counts rounds per PR
- [Headless agents](/quest/m0/helpers/headless-agents.md) - `/quest-spawn api` launches, resumes, and stops billed agents through one command auto mode allows

## Related

- [Agent lifecycle integration](/quest/m0/worktree-agents.md) - removes the agent-level load-average rules
