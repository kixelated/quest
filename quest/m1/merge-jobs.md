# [M] Extend merge jobs

## Goal

Merge jobs handle a PR that changes submodule pointers, continue after
someone else moves the head, and wake on GitHub events instead of polling.

## Plan

Decided 2026-10-24 (user) as follow-ups of
[kixelated/quest#209](https://github.com/kixelated/quest/pull/209), ranked
after launch:

Remaining work:

- **Moved heads.** Let the maintainer explicitly continue from a new live PR
  head through the existing decision and approval flow. Revalidate its exact
  identity and head, fence the question/attempt/old head, set the selected head
  and revision untrusted, and use normal dispatch classification. External
  heads never enter the trusted publication ledger.
- Preserve and safely reapply unpublished workspace changes before adopting
  the new head; conflicts become a maintainer decision. A paused job can move
  between runners, so its transfer mechanism remains a product choice.
  Existing publication checks the live head before creating a commit; an early
  foreign move leaves no pending commit to restore. Checkpoint events hold
  summaries, not workspace files, and dangling Git objects are not a durable
  transfer guarantee. Alternatives include a fenced snapshot in existing R2,
  an explicit checkpoint Git ref with ownership and cleanup rules, or pinning
  continuation to its original runner with an availability limitation. No new
  ref, pin, or artifact protocol is authorized by silence.

This PR implements the independent submodule-pointer and webhook-wakeup portions:
merge publication retains only pointers verified against the PR's existing head;
runner waits reread authoritative context after scoped webhook hints and
reconnects, with a generation guard across reading and subscribing.
