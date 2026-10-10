# [M] Answer runner questions in a decision inbox

## Goal

Maintainers see every change blocked on `## Questions` in one inbox, and each
question renders as an interactive prompt: context, numbered options, and the
recommendation preselected. Answering commits the unblock commit to the
change's branch (answers moved into the Plan, section removed), which turns
the change into a resume job for the next runner.

## Plan

- Decided 2026-10-07: interactive prompts are the main way maintainers steer
  agents in the UI. Runners never prompt; decisions are the maintainers'.
- Answer one question at a time or a whole round. A free-text "other" answer
  is allowed, as in the CLI prompt tools.
- Running quest-plan interviews in the UI is
  [a1](/quest/a1/plan-ui.md).

## Required

- [Questions section](/quest/a0/cloudflare/runners/questions.md) - the format it renders
- [Quest board](/quest/a0/cloudflare/board.md) - where the inbox lives
- [Changes](/quest/a0/cloudflare/changes.md) - blocked changes and their branches
