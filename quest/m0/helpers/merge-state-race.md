# [S] Land through a merge state GitHub is still computing

## Goal

`quest merge <pr> <token> --land <sha>` and a kix merge job land a PR on the
first try while GitHub still reports its merge state as `UNKNOWN`. Each merges
at once when nothing is left to wait for and enables auto-merge otherwise,
always pinned to `<sha>`, and neither fails with "Pull request is in clean
status". Labels on merged PRs are out of scope.

## Plan

Decided 2026-10-26 (user), from the merge of
[kixelated/quest#222](https://github.com/kixelated/quest/pull/222): its first
`--land` failed with "Pull request is in clean status", and the same command
merged it on a re-run. `land()` in `src/cli/hold.ts` and `landPullRequest` in
`cloudflare/src/github/service.ts` each pick `mergePullRequest` only when one
read of `mergeStateStatus` is `CLEAN`, `HAS_HOOKS`, or `UNSTABLE`; a state
GitHub has not computed yet reads `UNKNOWN` and falls through to
`enablePullRequestAutoMerge`, which GitHub refuses for a clean PR.

- **Retry on refusal (user).** Keep enabling auto-merge pinned to the head
  when the state is not known to be immediate. When GitHub refuses it because
  the PR is clean, re-read the state once and merge at once, still pinned to
  the head, if it is now `CLEAN`, `HAS_HOOKS`, or `UNSTABLE`; otherwise report
  the refusal. Rejected: re-reading while `UNKNOWN` (a timed poll), and trying
  `mergePullRequest` first (an admin token merges past required checks).
- **CLI and Worker (user).** Fix both in this quest, sharing the decision
  rather than keeping two copies of `IMMEDIATE` if the Worker can import it.
- **Labels stay (user).** A merged PR keeps its `quest:merge` label, as every
  merged PR does today; no cleanup and no backfill.
- Test each path: an `UNKNOWN` state that GitHub refuses as clean merges at
  once, an `UNKNOWN` state that accepts auto-merge stays on auto-merge, and a
  refusal for any other reason is reported unchanged.
- [kixelated/quest#229](https://github.com/kixelated/quest/pull/229) adds a
  gated branch to `land()` ahead of this choice; whichever lands second merges
  the other in.

## Related

- [Landing rules](/quest/m0/helpers/landing.md) - also changes what `quest merge --land` refuses
- [Batched merge gate: quest land](/quest/m0/helpers/land.md) - gated bases always enable auto-merge, so this choice applies only to ungated ones
