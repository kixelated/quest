# [M] Spawn and complete quests from the board

## Goal

The board does what `/quest-spawn` and `/quest-complete` do in an agent. Spawn:
a maintainer picks ready quests and they jump to the front of the runners'
queue. Complete: a maintainer sees changes with trusted green checks and an
approving trusted review, picks which to merge, and each becomes a merge job.
Both are interactive prompts with a recommendation.

## Plan

- Decided 2026-10-07: spawn and complete ship in a0; planning in the UI is
  [a1](/quest/a1/plan-ui.md).
- Spawn priority is app state that only reorders derived jobs. It doesn't
  lock anything, so it is lost harmlessly.

## Required

- [Quest board](/quest/a0/cloudflare/board.md) - where the actions live
- [Locks and live work](/quest/a0/cloudflare/runners/protocol.md) - the job order spawn changes
- [Runner merges](/quest/a0/cloudflare/runners/merge.md) - what complete enqueues
