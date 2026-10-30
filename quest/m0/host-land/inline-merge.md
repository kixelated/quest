# [S] Merge inline from the coordinator

## Goal

`/quest-complete` and `/quest-spawn` merge a picked PR inline, without a
sub-agent. `/quest-merge` reads the PR with `quest status`, and when a
`## Review` record the guide counts names the head (a recorded skip for a
trivial change included), it queues that head with `quest merge --land` and
reports. Otherwise it recommends `/quest-iterate`, which runs the review and
any changes, and queues afterwards. `/quest-spawn` and `/quest-complete`
recommend `/quest-iterate` for every PR whose head has no counted review.

## Plan

Decided 2026-10-30 (user, /quest-plan); see the
[epic](/quest/m0/host-land/README.md).

- `/quest-merge` no longer fixes conflicts, failing checks, or review
  findings, and no longer runs `quest check --base` or waits: the gate's
  check covers `quest check`, and its fixer owns conflicts and failures.
  Posted review findings that need changes make it recommend
  `/quest-iterate` instead of queueing.
- Drop the skills' re-dispatch of `/quest-merge` after a `merge_conflict` or
  `failed_checks` ejection; the fixer requeues those or hands them back,
  and a handed-back PR is asked about again.
- This works on today's land.yml gate too, so it can land before the host
  gate.
- Reconcile with [moq-dev/quest#288](https://github.com/moq-dev/quest/pull/288)
  and [moq-dev/quest#276](https://github.com/moq-dev/quest/pull/276), which
  also rewrite these skills, whichever lands first.
