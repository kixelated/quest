# [S] Stop the Windows lifecycle check failing with EBUSY

## Goal

The lifecycle check (`scripts/lifecycle-check.mjs`) never fails a Windows CI
job with `EBUSY` while removing its temporary directory, because nothing still
holds that directory when the check deletes it.

## Plan

Decided 2026-10-22 (user) as a follow-up of
[kixelated/quest#192](https://github.com/kixelated/quest/pull/192):

- The Windows arm64 Release job failed after its own checks passed, in the
  final `rmSync(work, { recursive: true, force: true })`, on #192 and on the
  `quest/m0/worktree` branch (run 39679528766). A rerun passed both times.
- Find which process or handle still holds the directory (for example a
  child process the check started, or a file it left open) and fix that
  cause. No retries, sleeps, or ignored errors.
- Reproduce it on a native Windows runner before fixing, and keep the fix
  covered by the existing lifecycle jobs.
