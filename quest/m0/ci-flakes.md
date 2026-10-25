# [M] Fail CI checks only on real breakage

## Goal

The native Windows test jobs and Release's macOS checks fail only when the
code under test is broken: no admission-count, timeout, or runner-queue
failure on a change that does not touch the code it exercises.

## Plan

Decided 2026-10-24 (user) from the spawn and merge wave that landed
[kixelated/quest#202](https://github.com/kixelated/quest/pull/202) through
[#219](https://github.com/kixelated/quest/pull/219), where native Windows
unit tests caused most failed Check runs, including on `main` (82a9566):

- **Gate headroom test (user).** `test/gate.test.ts` "concurrent processes
  never admit past the headroom" races 12 callers for 4 slots before a
  deadline of `SETTLE_MS/2` and asserts exactly 4 were admitted. Slow
  `windows-11-arm` and `windows-2022` runners, and loaded local hosts, admit
  2 or 3; the gate never admitted more than its headroom. Assert that
  invariant (never more than the headroom, in the output and the ledger) and
  that every caller is eventually admitted, rather than an exact count by a
  fixed deadline. Rejected: treating under-admission on a slow host as a gate
  bug.
- **Timeouts.** Find why `test/move.test.ts` ("refuses a claimed quest",
  "reports mentions it does not edit"), several `test/start.test.ts` tests,
  and `test/landed.test.ts` exceed vitest's 5 s on native Windows, and fix
  that cause. No raised timeouts, retries, or sleeps.
- **Release's macOS queue (user).** Release's macOS `check` jobs can wait
  out a GitHub macOS capacity notice and show as a failed check on a PR, as
  the `lifecycle (macos-14)` job did before
  [kixelated/quest#218](https://github.com/kixelated/quest/pull/218). Apply
  the same decision: keep macOS covered on pushes to `main` and where it
  guards release artifacts, without failing PRs on a runner that never
  arrived.
- Reproduce each on its native runner before fixing, as #218 did.
