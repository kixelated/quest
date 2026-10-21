# [S] Remove finished quest worktree checkouts

## Goal

`quest worktree remove` deletes a finished checkout that `quest worktree` created
and drops its record, without losing work: it refuses while supervised runs are
live and refuses a checkout that still holds anything not already preserved.

## Plan

- Landed in [kixelated/quest#127](https://github.com/kixelated/quest/pull/127):
  disk capacity and reservations, `create`, `release` (delete declared scratch
  in place), and `restore`. Landed with this quest's first slice: scratch
  declared at `create`, and `run`, which supervises a command in a systemd user
  scope per run, kills leftover descendants once the command exits, and prunes
  scratch when the checkout's last run stops. Crashed supervisors are
  reconciled by the next `quest worktree` command once their scope is empty,
  and a dead process's registry lock is reclaimed.
- Decided (user, 2026-10-21): prune in place. Release never removes the
  checkout or its Git state. Checkout-independent recovery is out of scope:
  four review rounds of the checkpoint-and-remove design kept finding
  data-loss edge cases.
- Decided 2026-10-21 (user): process ownership is a systemd user scope, on
  Linux only; other hosts fail explicitly. Process groups and PID files cannot
  prove detached descendants stopped after a supervisor crash.
- Remaining (maintainer, 2026-10-21, from
  [kixelated/quest#127](https://github.com/kixelated/quest/pull/127)):
  `quest worktree remove` for finished checkouts. Never force: refuse modified,
  untracked, or undeclared ignored files, and commits no branch or remote ref
  reaches. Treat a squash-merged branch as finished only with exact PR-head
  evidence from the forge, behind an interface that keeps the core
  forge-independent.
- Measured 2026-10-21 on this repository: a fresh checkout is 2.9 MB, 394 MB
  after installing dependencies and building, and 2.9 MB once `run` released
  it. A suspended job keeps the same released footprint until it is restored.
- Native agent lifecycle adoption stays in the agent integration quest.

## Related

- [Gate contention measurements](/quest/m0/local-gate.md) - independent CPU and memory admission
- [Agent lifecycle integration](/quest/m0/worktree-agents.md) - native agents and workflow adoption
