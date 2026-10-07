# [XS] Flag a quest and an epic that share a path

## Goal

`quest check` reports a tree that has both `<dir>/x.md` and `<dir>/x/README.md`.
Both map to the same board page, so the epic's page is unreachable. Git also
can't hold `x.md`'s branch `<dir>/x` beside the branches of quests under `x/`
(`<dir>/x/...`), so one side can't be claimed. The finding names both files,
and a test covers it.

## Plan

Decided on 2026-10-07, from the review of kixelated/quest#84. It's a `check`
rule in the shared core, so the Worker and the CLI agree.
