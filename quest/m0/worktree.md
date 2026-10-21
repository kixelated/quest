# [M] Own worktree processes and release checkouts automatically

## Goal

`quest worktree` supervises the commands that run in a checkout it created,
then releases that checkout automatically once they stop by pruning its
declared scratch in place. A crash or cancellation is reconciled without losing
work, stealing a live lock, or deleting scratch a running process still uses.

## Plan

- Landed in [kixelated/quest#127](https://github.com/kixelated/quest/pull/127):
  manual disk capacity and reservations, `create`, `release` (delete declared
  scratch in place), and `restore` (reserve again; the caller rebuilds the
  scratch) of Git-owned checkouts. The README section "Prunable local
  checkouts" documents it as experimental and tells users to stop all work
  before releasing.
- Decided (user, 2026-10-21): prune in place. Release deletes only declared
  scratch that Git ignores, that holds no tracked files or other Git worktree,
  and that is not reached through a symlink; it never removes the checkout or
  its Git state.
  Checkout-independent recovery is out of scope: four review rounds of the
  checkpoint-and-remove design kept finding data-loss edge cases, while the
  disk cost is scratch (2026-10-15 on this repository: 1.6 MB fresh source,
  376 MB built).
- Decided 2026-10-21 (user): this quest brings its own process-ownership
  backend; `quest gate` admits on CPU load and memory only and owns no
  descendants. The Linux systemd scope backend (scopes, slot handshake,
  `cgroup.kill` inode pinning, prerequisite probes, opt-in systemd tests) was
  dropped from the gate and is restorable from commit 5684307 in
  [kixelated/quest#128](https://github.com/kixelated/quest/pull/128). Process
  groups and PID files cannot prove detached descendants stopped after a
  supervisor crash, so hosts without a supported backend fail explicitly
  instead of guessing.
- Own foreground child processes and their descendants until they stop; only
  then prune scratch and release the reservation. Record ownership so a crash
  can be reconciled, including a stale registry lock whose owner has exited.
  Report failed cleanup as a retained allocation, not success.
- Release automatically at lifecycle boundaries: before a blocking handoff and
  at completion, once meaningful edits are committed. An asynchronous question
  with independent work still running is not a release boundary. Automatic
  release needs the scratch declarations without a caller; recording them at
  `create` is the expected route.
- Add cancellation and crash fixtures: interrupt a supervised command with live
  descendants, kill the supervisor, and reconcile. Measure retained disk after
  complete and suspended jobs.
- Native agent lifecycle adoption stays in the agent integration quest.

## Related

- [Agent lifecycle integration](/quest/m0/worktree-agents.md) - native agents and workflow adoption
