# [XS] Show PR holds in quest status

## Goal

`quest status <pr>` shows whether a `quest:*` hold is on the PR: its label,
how long ago it was taken, and the hold's timeline event, so `/quest-complete`
can skip PRs another session holds without a separate label read.

## Plan

Decided 2026-10-22 (user) as a follow-up of
[kixelated/quest#185](https://github.com/kixelated/quest/pull/185), which
added the holds:

- Read the hold the same way the state commands do, through the shared
  GitHub client, and report a draft its starter still holds the same way.
- Update the `complete` skill to read holds from `quest status`, and the
  README's status example.
- Ranked after the [complete loop](/quest/m0/helpers/complete-loop.md), which
  also edits `complete`.
