# [S] Keep working unattended with /quest-afk

## Goal

`/quest-afk` keeps quest work moving while the user is away and asks
nothing: it skips every decision instead of choosing one, leaves each skipped
decision on its PR, and keeps starting agents and PRs for work the user
already agreed to. Every quest skill ends with a final summary, so returning
starts with what needs the user. This replaces the steering the user typed in
about 20 moq sessions ("I'm going to bed", "you don't need to decide
everything, only when blocked", "I'm back, what decisions need to be made")
and the one-line global `/afk` and repository `/recommended` skills.

Non-goals: a wind-down mode that stops dispatching ("just make the PRs then
stop"), and noticing the user's return; the final summary covers it.

## Plan

Decided 2026-10-21 (user), replacing the 2026-10-19 `afk` argument on
`/quest-complete` and `/quest-spawn`, from an audit of a month of moq
maintainer transcripts. That argument landed the same day in
[kixelated/quest#166](https://github.com/kixelated/quest/pull/166) as an
`## Unattended` section in `assets/skills/complete.md` and
`assets/skills/spawn.md`, plus a README sentence. It acts on its own
recommendations, answers simple decisions agents report, and still asks about
each merge and delete. This quest replaces it:

- A skill of its own, `/quest-afk`, not an argument on two skills. Delete
  both `## Unattended` sections and the README's `afk` sentence in the same
  PR. At the user's request the old skills were removed the same day, ahead
  of this quest, so the user types those instructions by hand until it
  lands: the global `/afk` link in kixelated/dotfiles, the `afk` skill in
  [kixelated/skills#8](https://github.com/kixelated/skills/pull/8), and the
  `/recommended` links in
  [moq-dev/moq#6200](https://github.com/moq-dev/moq/pull/6200) and
  moq-dev/moq.pro.
- It makes no decisions. Every question a quest skill would ask is skipped,
  not answered with its recommendation: the PR stays a draft listing the
  decision with a recommendation, a quest that would need asking is left
  unstarted and listed, and suggested follow-ups wait for `/quest-plan`.
  Unlike the landed argument, it picks no skip, `/quest-ready`, or
  `/quest-iterate` for a PR the user has not picked, answers no reported
  decision, and asks nothing about merges or deletes: it never merges or
  deletes on its own judgment.
- It keeps going as far as already agreed work allows: it starts ready
  quests that `/quest-spawn` starts without asking, and carries on the actions
  the user already picked, until nothing is left that needs no decision.
- Decided (user): every quest skill ends with a final summary in sections,
  such as its PRs and their states, the open decisions, and suggested
  follow-ups. Don't fix the exact shape. State this once in the guide rather
  than in each skill.
- Write `assets/skills/afk.md` following `PROMPTING.md`, reusing the spawn
  and complete skills' dispatch rules instead of restating them. Register it
  in `src/cli/skills.ts` and the README's skill table; existing
  repositories get its `quest-afk` stub by rerunning `quest init`. The user
  asked for the skill and guide edits through this plan.
