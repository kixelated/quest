# [S] Wake quest wait on review replies and reactions

## Goal

`quest wait <pr>` returns when someone other than the waiter replies in a
review thread or reacts to the PR body or one of its reviews. A clean Codex
review, which only leaves a 👍 reaction, ends the wait instead of running to
`--timeout`.

## Plan

- Decided 2026-10-14: count review comments (`/pulls/{n}/comments`) and
  reactions on the PR body and its reviews. Leave out reactions on every
  other comment to keep each poll's API cost bounded.
- Neither signal shows up in the issue timeline that `quest wait` polls now.
  Add these endpoints to the same conditional, rate-limit-aware polling loop
  and extend the resume cursor so that resuming doesn't replay or miss them.
- Ignore the waiter's own comments and reactions. Comments posted through the
  API create no timeline event, so an agent's own replies must not wake it.
- Keep the README and `--help` output in sync with the new event kinds.
- Follow-up from #104, whose agent waited out several clean Codex reviews.
