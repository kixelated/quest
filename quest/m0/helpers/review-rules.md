# [S] Settle the review rules that stalled merges

## Goal

Merge agents stop asking about reviews in three recurring cases.

- **Identical diff.** A head whose diff against the new base equals the
  reviewed diff keeps that review, even after a hand-resolved merge.
- **Declined finding.** Codex's posted review with no new findings counts
  when the only finding it still lists is one a maintainer decision declined.
- **Stalled review.** A review that hasn't finished after one bounded wait
  goes to the maintainer instead of being re-requested.

## Plan

Decided 2026-10-28 (user, /quest-plan of the follow-ups from a 25-PR /quest-complete run).

- **Identical diff** goes in the guide's Reviews section, beside the existing
  exemptions (a conflict-free base merge, an unchanged reviewer patch). #233's
  hand-resolved merge left its diff byte-identical to the reviewed head, yet it
  still waited 45 minutes for a review. Name a check agents can run, such as
  comparing `git diff <base>...<head>` before and after the merge.
- **Declined finding** goes in `CONTRIBUTING.md`'s review policy. Codex never
  posts a 👍 while a declined advisory stays listed, even after its thread is
  resolved. So #246 could never get a qualifying review after a hand-resolved
  merge.
- **Stalled review**: the guide already says to ask the user when a wait times
  out. `CONTRIBUTING.md` adds that a Codex run stuck at "running" counts as
  timed out. Agents still never request reviews; only the maintainer may.
