# [S] Read claims from the upstream tree

## Goal

`quest unblocked --unclaimed` and `quest start` agree with GitHub about which
quests are ready and claimed, even when the local checkout is behind or the
repository keeps merged branches.

## Plan

Decided 2026-10-21 from the follow-ups of
[kixelated/quest#164](https://github.com/kixelated/quest/pull/164) and
[kixelated/quest#167](https://github.com/kixelated/quest/pull/167), and a
spawn on 2026-10-21 where two quests that had partly landed were skipped as
"held by branch ..., with no open PR":

- **Merged heads (user).** A branch whose tip is the head of a merged PR no
  longer counts as a claim: its work landed. A closed, unmerged PR's branch
  still counts, since it may hold abandoned work someone wants back.
  Repositories without GitHub's "Automatically delete head branches" keep
  every merged branch; kixelated/quest turned that setting on and deleted
  115 such branches the same day.
- **Upstream tree.** Check readiness against the fetched upstream default
  branch's tree, not the local checkout, so a stale checkout cannot report a
  finished prerequisite as open or a deleted quest as ready. The landed-quest
  guard from [kixelated/quest#169](https://github.com/kixelated/quest/pull/169)
  already loads a tree from a ref; reuse it.
- **Head repository.** Derive the head repository from the remote's push URL
  (which may differ from its fetch URL), parsing SSH and HTTPS remote URLs
  through one helper in `src/cli/github.ts`.
- Test a merged-head branch, a closed-PR branch, a checkout behind upstream,
  and a remote whose push URL differs from its fetch URL.
