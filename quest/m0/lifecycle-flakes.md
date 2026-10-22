# [S] Stop the lifecycle CI jobs failing at random

## Goal

The lifecycle CI jobs fail only when the code under test is broken: the
Windows check never fails with `EBUSY` while removing its temporary
directory, and a macOS job that never gets a runner does not show as a
failed check.

## Plan

Decided 2026-10-22 (user) as follow-ups of
[kixelated/quest#192](https://github.com/kixelated/quest/pull/192) and
[kixelated/quest#191](https://github.com/kixelated/quest/pull/191):

- **Windows `EBUSY`.** The Windows arm64 Release job failed after its own
  checks passed, in the final `rmSync(work, { recursive: true, force: true })`
  of `scripts/lifecycle-check.mjs`, on #192 and on the `quest/m0/worktree`
  branch (run 39679528766). A rerun passed both times. Find which process or
  handle still holds the directory (for example a child process the check
  started, or a file it left open) and fix that cause. No retries, sleeps, or
  ignored errors. Reproduce it on a native Windows runner before fixing.
- **macOS queue timeout.** On #191 and
  [kixelated/quest#185](https://github.com/kixelated/quest/pull/185), the
  optional `lifecycle (macos-14)` job waited 15 minutes for a hosted runner
  during a GitHub macOS capacity notice, was cancelled without running, and
  showed as failed. Decide from the workflow (`.github/workflows/check.yml`)
  whether to shorten its queue limit, report it as skipped, or drop it from
  pull request runs, keeping macOS covered somewhere.
- Keep both fixes covered by the existing lifecycle jobs.
