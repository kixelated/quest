# [L] Plan quests in the web UI

## Goal

A maintainer starts a quest-plan interview from the board. A runner drafts each
round of questions, the maintainer answers them inline as interactive prompts,
and the session ends in a change that adds or updates quests, with the
decisions recorded as a paper trail. A maintainer never needs an agent CLI to
plan.

## Plan

- Decided 2026-10-07: quest-plan, quest-spawn, and quest-complete should be
  built into the UI. Spawn and complete shipped in a0 as
  [board actions](/quest/a0/cloudflare/runners/board-actions.md); planning
  waits for a1 because it needs multi-round sessions.
- Reuse the decision inbox's prompt rendering and the runner's end-and-resume
  model: each round is a job that ends with `## Questions`.

## Required

- [Quest on Cloudflare](/quest/a0/cloudflare/README.md) - runners, the inbox, and board actions
