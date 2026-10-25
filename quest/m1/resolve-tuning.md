# [S] Measure and refine the quest merge driver

## Goal

The `quest resolve` merge driver's real effect is measured on moq-dev/moq's
merge history, and its unresolved conflict markers match git's own labels
and marker size.

## Plan

Decided 2026-10-24 (user) as follow-ups of
[kixelated/quest#219](https://github.com/kixelated/quest/pull/219), ranked
after launch:

- **Replay.** Rerun the plan's replay of 280 merges of `main` into PR
  branches in moq-dev/moq through the driver, and record how many of the 29
  quest-only conflicts it resolves and which shapes still conflict.
- **Marker labels.** Register the driver with git's `%L`, `%X`, and `%Y` and
  pass them to `git merge-file`, so markers carry git's branch labels and
  marker size.
