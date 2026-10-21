# [M] Keep the inbox accurate on busy projects

## Goal

The board and decision inbox show each quest and PR in its real state, mark
items unread only when something a maintainer would act on changed, and stay
fast on repositories with long histories.

## Plan

Decided 2026-10-21 from the follow-ups of
[kixelated/quest#132](https://github.com/kixelated/quest/pull/132),
[kixelated/quest#157](https://github.com/kixelated/quest/pull/157), and
[kixelated/quest#163](https://github.com/kixelated/quest/pull/163):

- **Draft claims.** The board classifies a draft PR without a
  `## Decisions needed` section as claimed work in progress, owned by its
  starter, and a draft with that section as waiting on the maintainer, as the
  guide defines. Today a draft without the section can show as Accepted.
- **Unknown merge state.** GitHub reports `mergeStateStatus` `UNKNOWN` while it
  computes mergeability. On an already-recorded PR, treat it as not yet known:
  keep the item's previous state and do not mark it unread until a definite
  state arrives. A newly seen PR still surfaces as unread, since GitHub may
  send no further event once the computation finishes.
- **Retention (user).** Page every activity read (`readState` in
  `cloudflare/src/github/state.ts` reads every row on each `/board`, `/state`,
  `/data`, and inbox view), and prune a closed entity's activity rows once it
  has been closed for a fixed period. Choose the period from measured row
  counts on a busy pilot repository and record it here. Rejected: paging
  without pruning (unbounded storage) and dropping rows on close (the board
  loses closed history).
- Extend the seeded dev server (`cloudflare/dev/seed.ts`) with a claimed
  draft, a draft that hands back decisions, and an `UNKNOWN` PR, so
  `test/seed.test.ts` covers each state.
- Keep `test/seed.test.ts` within the Worker suite's 5-second test timeout as
  the seed grows; it was the only test to time out under 8× CPU overload in
  [kixelated/quest#177](https://github.com/kixelated/quest/pull/177). Slim it
  rather than raising its timeout.
