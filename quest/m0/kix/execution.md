# [L] Spawn and iterate hosted work from decision prompts

## Goal

A maintainer starts ready work through kix.quest and follows the resulting
Agent SDK implementation session, answers its questions, and receives a
normal contribution PR. New PR notifications present useful next actions,
including explicitly requested iteration, in the same decision UI.

## Plan

- Hosted planning and implementation ship before local integrations,
  confirmed on 2026-10-13. Use the same executor, funding controls, prompt
  contract, and publisher instead of a separate agent orchestration stack.
- Apply quest-spawn selection/readiness behavior and the existing
  quest-start/quest-iterate workflows. A project opt-in authorizes eligible
  ready default-branch quests; explicit UI selection can prioritize work.
  Draft or blocked plans and already active/open work are not started again.
- Select a project or per-quest implementation allocation explicitly and
  keep the payer fixed for the attempt. Project planning-only funds cannot
  pay implementation.
- Each job owns an isolated worktree/container, follows repository
  instructions, and runs applicable checks. The product does not require
  every project to adopt Nix or replace its GitHub CI.
- Questions and significant findings pause into the UI with context,
  recommendations, and choices. Explicitly selected revisions resume the
  relevant session/PR with fresh authorization and funding.
- Preserve results when the agent stops, fails, or exhausts funding. Report
  the actual state and next action; do not mask failures with repeated runs.
- Stop implementation at PR delivery. Subsequent review/iteration/merge
  choices are explicit maintainer actions, with GitHub enforcing its normal
  review and merge rules. Independent donated reviews and CI come later.
- Cover the real prompt loop in integration tests, including simultaneous
  starts, a stale PR head, a blocked decision, and a revoked allocation.

## Required

- [Web planning](/quest/m0/kix/planning.md) - the complete hosted decision/session/publication path
