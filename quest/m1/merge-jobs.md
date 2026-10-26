# [M] Extend merge jobs

## Goal

Merge jobs handle a PR that changes submodule pointers, continue after
someone else moves the head, and wake on GitHub events instead of polling.

## Plan

Decided 2026-10-24 (user) as follow-ups of
[kixelated/quest#209](https://github.com/kixelated/quest/pull/209), ranked
after launch:

- **Submodule pointers.** #209 refuses a merge publication whose snapshot
  skipped a submodule change, since kix builds the merge commit's tree from
  the base and would revert the PR's pointer. Carry the PR's existing
  pointers into the merge tree instead, which means publishing submodule
  pointers kix avoids today.
- **Moved heads.** A head moved by anyone but the job pauses it into a
  decision that needs a new pick. Let the maintainer continue from the new
  head in that decision.
- **Webhook wakeups.** The runner's `wait` tool polls every minute for up to
  55 minutes. Wake a waiting job from the `pull_request`, review, and check
  webhooks kix already receives.
