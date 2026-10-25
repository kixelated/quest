# [S] Release merge holds reliably

## Goal

No PR keeps a `quest:merge` hold for a merge job that has ended, whatever path
ended it, and the CLI and the Worker read and apply `quest:*` holds through
one shared definition.

## Plan

Decided 2026-10-24 (user) as a follow-up of
[kixelated/quest#209](https://github.com/kixelated/quest/pull/209), whose
reviews found a missed release path in each of four rounds (a stopped attempt
that never reported, dispatch before the hold was recorded, a cancel racing
the label):

- **Sweep.** A scheduled pass releases the hold of every merge job that has
  ended without a landing in progress, as a backstop for any release path the
  job's own lifecycle misses.
- **One definition.** `src/cli/hold.ts` and the Worker each decide which
  labels are holds and when a hold is spent. Move that rule into the core
  (`quest/core`) and have both call it, as `landed()` did for merged claims
  in [kixelated/quest#217](https://github.com/kixelated/quest/pull/217).
- Test a hold left by each path #209 fixed, released by the sweep, and a
  live job's hold left alone.
