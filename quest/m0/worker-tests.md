# [S] Make every Worker test pass on its own

## Goal

Each Worker test (`cloudflare/test/`) passes when run alone, in any order, or
in the full suite, because no test depends on D1 state another test left
behind.

## Plan

Decided 2026-10-22 (user) as a follow-up of
[kixelated/quest#188](https://github.com/kixelated/quest/pull/188):

- A test in `cloudflare/test/publish.test.ts` passed in the full suite but
  failed alone with a foreign-key error until it inserted its second user
  itself, so D1 state leaks between tests in a full run.
- Find how state is shared (per-file or per-suite storage, seeded rows,
  module-level fixtures) and make each test set up what it needs, rather than
  fixing tests one at a time as they surface.
- Prove it by running each Worker test file alone and the suite in a shuffled
  order, and keep a check in CI that would catch a new order dependence.
