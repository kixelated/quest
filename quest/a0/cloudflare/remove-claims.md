# [S] Remove claim sections

## Goal

`## Claim` is gone from the quest format. `quest check` no longer recognizes
it (an unknown section again), `quest ready` no longer treats it as a blocker,
and the CLI no longer shows `Claimed by`. The README, `quest guide`,
`docs/getting-started.md`, the theme copy, and `quest-start` describe how work
is taken now: a live runner lock on Quest on Cloudflare, an open change for
the quest, or, on GitHub, the existing branch claim.

## Plan

- Decided 2026-10-07 while planning [runners](/quest/a0/cloudflare/runners/README.md):
  MoQ announcements lock active work, and git only says what the next job is.
  The user wants no durable markers, because a crashed session's announcement
  clears itself while a claim needs expiry.
- The user authorized editing `assets/` (the guide and skills) for this.
- [Fork intake](/quest/a0/cloudflare/intake.md) already shrank to issues in
  the planning PR. Confirm that draft PR #40 (head
  `quest/m0/cloudflare/intake`) drops its claim promotion, 48h expiry, and
  claim Durable Object before it merges, and remove any claim code that
  already landed on main.
