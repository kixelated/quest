# [L] Plan quests through web interviews

## Goal

A maintainer opens an issue notification or starts a planning conversation
on kix.quest, answers the agent's interactive rounds, and receives a draft
GitHub PR containing the proposed quests and recorded decisions. The
interview runs on one of their runners; they never see a terminal.

## Plan

- Promoted from later work on 2026-10-13. The web quest-plan experience is
  central to the first release, not an add-on after a runner dashboard.
- Use the shared quest-plan workflow through the runner's adapters. The
  model reads repository context and asks the questions; the UI presents
  them and returns explicit maintainer answers.
- Planning runs on a routed runner and account like any other job. Show the
  runner and account in a compact secondary control. When the account hits
  its limit, pause with a decision to switch accounts instead of switching.
- Treat incoming issue text as untrusted context. A new issue notification
  alone does not authorize an interview or accept the issue as a plan.
- Keep the current frontier of questions, prior answers, and draft proposal
  across reconnects. Consequential choices wait for answers; time passing
  and selected defaults are not approval.
- The bot creates/updates a draft quest PR with settled decisions and the
  interview paper trail. Merging through GitHub makes the resulting ready
  quests eligible; a draft planning branch cannot start implementation.
- Reuse the same prompt flow when an implementation worker needs a decision.
  Record the settled answer in its plan where relevant without adding a
  service-specific required section to the core quest format.

## Required

- [Runner](/quest/m0/kix/runner.md) - planning sessions, questions, and resumption
- [Decision inbox](/quest/m0/kix/prompts.md) - the interactive rounds and notifications
- [Bot publication](/quest/m0/kix/publication.md) - draft planning PRs and recorded decisions
