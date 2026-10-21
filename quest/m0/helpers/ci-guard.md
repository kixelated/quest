# [XS] Run the landed-quest guard in CI

## Goal

This repository's pull request CI fails when a PR would leave its quest
inaccurate, so merges that skip `/quest-merge` are checked too.

## Plan

Decided 2026-10-21 as a follow-up of
[kixelated/quest#169](https://github.com/kixelated/quest/pull/169):

- Run `quest check --base origin/<base> --branch <head>` (README, "Check a
  quest's PR") in `.github/workflows/check.yml` on pull requests, using a
  trusted `quest` built from the base branch, never the head's code or
  runtime config, as the merge skill requires.
- Non-quest branches already pass, so no extra filtering is needed.
- Confirm it passes on a planning PR and fails on a PR that finishes a quest
  without deleting or updating it.
