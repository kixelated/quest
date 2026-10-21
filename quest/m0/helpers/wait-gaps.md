# [S] Never miss events in quest wait

## Goal

Every review, comment, and check result after the wait's starting point is
reported exactly once, however long after a push the wait starts and however
close to its timeout the event lands.

## Plan

Decided 2026-10-21 from merge agents' reports that day:

- A wait started without `--since` about a minute after a push timed out after
  540 s without reporting a Codex review that landed in that window
  ([kixelated/quest#127](https://github.com/kixelated/quest/pull/127)). Waits
  started with `--since` from before the push reported it every time.
  Reproduce it, find the root cause (for example the default point resolving to
  the wrong push time, or update-time filtering), and fix it.
- Check that an event landing in the last poll interval before the timeout is
  either reported or left for the returned cursor, never dropped.
- A merge agent saw the resume cursor as `Q1.` while the CLI accepts only
  `q1.` ([kixelated/quest#172](https://github.com/kixelated/quest/pull/172)).
  Confirm whether `quest wait` ever prints it that way; if not, record it as a
  display quirk and change nothing.
- Add regression tests for each confirmed cause.
