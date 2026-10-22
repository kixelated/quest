# [XS] Choose the activity retention period

## Goal

The Worker prunes a closed issue or PR's activity row after a retention period
the user chose from measured row counts, so the activity log
keeps the closed history maintainers use and storage stays bounded.

## Plan

- Retention (user): `RETENTION` in `cloudflare/src/github/state.ts` is 30
  days until the user decides. Pruning, paged reads, draft claims, and the
  `UNKNOWN` merge state shipped with it.
- Activity rows mirror GitHub entities one to one, so the counts come from
  GitHub. Measured 2026-10-21 on
  [moq-dev/moq](https://github.com/moq-dev/moq), the busiest candidate pilot:
  6,265 issues and PRs, 98 open, and 766 closed in the last 7 days, 2,380 in
  30, 3,687 in 90, and 4,795 in 180. Steady-state rows are the open count plus
  those closed within the period: about 0.9k at 7 days, 2.5k at 30, and 3.8k
  at 90. [kixelated/quest](https://github.com/kixelated/quest) keeps every
  row under any period (192 in total).
- Only the paged activity log shows closed rows; the board, inbox, and jobs
  read open rows through a partial index whatever the period.
- Once the period is chosen, set `RETENTION` with its reason in the comment
  beside it, and delete this quest.
