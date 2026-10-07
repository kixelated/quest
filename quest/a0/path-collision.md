# [XS] Flag a quest and an epic that share a path

## Goal

`quest check` reports a tree that has both `<dir>/x.md` and `<dir>/x/README.md`.
Both would get the branch `<dir>/x` and the same board page, so neither could
be claimed or viewed on its own. The finding names both files, and a test
covers it.

## Plan

Decided on 2026-10-07, from the review of kixelated/quest#84. It's a `check`
rule in the shared core, so the Worker and the CLI agree.
