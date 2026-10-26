# [S] Keep native Windows git tests within their time limit

## Goal

The native Windows test jobs fail only when the code under test is broken:
no `test/move.test.ts` or `test/landed.test.ts` timeout on a change that does
not touch the code it exercises.

## Plan

Decided 2026-10-24 (user): find why these tests exceed vitest's 5 s on native
Windows, and fix that cause. No raised timeouts, retries, or sleeps.

Found while reproducing on the native runners for
[kixelated/quest#233](https://github.com/kixelated/quest/pull/233), which
fixed the gate headroom test and Release's macOS queue:

- These tests spend about 95% of their time starting git: 8-13 processes per
  test, at 35-80 ms each inside the test workers, against about 2 ms on Linux.
  The slowest take 0.8 s on `windows-2022` and 1.4 s on `windows-11-arm`
  (Defender real-time scanning on), whether the files run in parallel or alone.
- The four timeouts since 2026-10-21 ran about 3x to 20x slower than that,
  three of them within 15 minutes during a CI burst on 2026-10-24, on hosts
  whose other test files were also slow. Fewer git processes per test would
  not absorb a 20x stall within 5 s.
- Open (user): whether these files take a longer file-level time limit, like
  `test/start.test.ts` (30 s), `test/snapshot.test.ts` (20 s), and
  `test/worktree.test.ts` (20 s) already do; or cut their git processes
  (copied fixture repositories, `maintenance.auto=false`, and batching the
  CLI's repeated `git remote`/`git config` lookups) and keep 5 s.
