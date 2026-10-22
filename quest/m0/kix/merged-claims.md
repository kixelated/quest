# [XS] Ignore merged branches on the board

## Goal

The kix board and inbox agree with `quest unblocked --unclaimed` about which
quests are claimed: a `quest/*` branch whose tip is the head of a merged pull
request no longer counts as a claim, while a branch whose pull request closed
unmerged still does.

## Plan

Decided 2026-10-22 (user) as a follow-up of
[kixelated/quest#192](https://github.com/kixelated/quest/pull/192), which
gave the CLI this rule:

- `cloudflare/src/github/state.ts` maps every observed `quest/*` ref to a
  claim (`associatedQuest`). Apply the same merged-head rule when reading
  those refs, and keep the CLI and Worker on one definition of it rather
  than a second copy.
- Ranked last in the epic: moq-dev/moq, moq-dev/moq.pro, and kixelated/quest
  all delete head branches on merge, so only projects without that setting
  see stale claims today.
- Test a merged-head branch, a closed-unmerged branch, and a merged branch
  with commits pushed after the merge, with the seeded fake GitHub
  (`cloudflare/dev/github.ts`).
- Dropped (user): a CLI sweep that reports or deletes merged quest branches,
  since every current repository deletes them on merge.
