# [M] Report a PR's state with quest status

## Goal

`quest status <pr>` prints a pull request's current state in one call, plain
or `--json`, so agents stop chaining `gh api .../reviews|comments|reactions`
and `reviewThreads` GraphQL queries, often right after `quest wait` returns
(219 of 396 sessions). It reports facts; it never decides whether the PR is
ready to merge or whose review counts.

## Plan

- Decided 2026-10-19 (user): report the head SHA, draft and open state,
  failing and pending checks with whether each is required, mergeability,
  auto-merge, and merge-queue state.
- Decided (user): report each reviewer's latest review marked current or
  stale against the head, and reactions on the PR and its reviews, as
  `quest wait` reports them.
- Decided (user): report unresolved review threads with their node IDs,
  path, line, last author, and URL, so an agent can reply to or resolve one
  without another query.
- Accept the same PR argument as `quest wait`: a GitHub PR URL, or a number
  in origin. Use one GraphQL query where it fits (`statusCheckRollup` with
  `isRequired(pullRequestNumber:)`, `reviews`, `reviewThreads`,
  `mergeQueueEntry`, `autoMergeRequest`), paginating long lists.
- Plain output is stable lines meant for agents; `--json` is a documented,
  deterministic object. Exit 0 for any PR state; non-zero only when the
  command fails, matching `quest ready`.
- Point `merge`, `iterate`, and `complete` skill prose at it for reading a
  PR's state, especially after `quest wait` wakes.
- Test with recorded responses: stale and current reviews, a required and an
  optional failing check, a queued PR, resolved and unresolved threads, and
  pagination.
