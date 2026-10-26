# [S] kixelated/quest lands through quest land

## Goal

PRs to kixelated/quest's `main` land only through
[`quest land`](/quest/m0/helpers/land.md), on a hosted runner, running
`just check` and `just test` once per batch. GitHub's merge button cannot
land around it.

## Plan

Decided 2026-10-26 (user): the repository adopts its own gate first. Being
user-owned, it cannot use GitHub's merge queue
([landing](/quest/m0/helpers/landing.md)).

- The push credential is GitHub Actions in the `main` ruleset's bypass list,
  guarded by a test that refuses `contents: write` anywhere but the land job,
  as moq.pro's `queue.test.ts` does. The admin role keeps its emergency
  bypass. Ruleset writes are the user's.
- The ruleset requires a check that PR heads never carry, so auto-merge only
  waits for the gate.
- Update `CONTRIBUTING.md`'s landing section; the user asked for it through
  this plan.

## Required

- [Batched merge gate: quest land](/quest/m0/helpers/land.md) - the engine
