# [S] Measure quest gate under representative contention

## Goal

`quest gate <cmd>` holds expensive commands for one user on one host until the
host has CPU and memory room, shared across repositories and worktrees.
Concurrent agent sessions remain useful without multiplying full-machine builds
and test stacks.

Load and memory admission and its automatic use by `just check` / `just test`
have landed. What remains is measuring representative build/test contention
with and without the gate, for example how many concurrent Worker suites hit
their 5-second timeouts, before claiming a responsiveness improvement.

## Plan

- Decided 2026-10-15: gate expensive command phases, not agent lifetimes.
  Repository entrypoints invoke the gate automatically; ordinary reasoning and
  I/O are not gated. No adaptive scheduler or new daemon is needed for this scope.
- Decided 2026-10-15 (user): gate checks and CI-like suites on host load, not
  agents, because load from every session and user is what starves test timers.
  The agent-level load-average rule was removed from the spawn and complete skills.
- Decided 2026-10-21 (user): admission is load and memory only, on every
  platform. This supersedes the 2026-10-15 decisions to add Linux systemd scope
  slots on top: every review round on the scope handshake, `cgroup.kill` inode
  pinning, and manager probes found another race, for little admission benefit.
  Exact descendant ownership and orphan cleanup move to the
  [worktree process-ownership quest](/quest/m0/worktree.md). The removed
  backend, its probes, and its opt-in systemd suite are recoverable from commit
  5684307 in [kixelated/quest#128](https://github.com/kixelated/quest/pull/128).
- Decided 2026-10-15 (user): Bun's `--no-orphans` stays a research option. Its
  best-effort registration and bounded PID-tree walks do not establish exact
  ownership by themselves.
- Decided 2026-10-15: at most one admission per 5-second window across all
  callers, claimed by exclusively creating a per-window file. The load average
  lags new work and is sampled every 5 seconds, so waiters that all see it fall
  must not start together. Nothing is held across the command, so a crash
  leaves no stale lock. Claims live in `$XDG_RUNTIME_DIR`, or a per-hostname
  cache directory, because a home directory may be shared between hosts.
- Decided 2026-10-15 (user): limits come from host specs, with no configuration
  file. The load limit is the host's CPU count, because the load average counts
  every CPU, including ones outside this process's affinity (revised
  2026-10-21 from the usable core count). Admission waits while available
  memory is below `min(4 GiB, RAM / 4)`: 4 GiB is a typical build or test
  stack, and a small host still runs one command. RAM is capped by a cgroup
  memory limit, and cgroup headroom subtracts inactive file cache from usage,
  since it is reclaimable. macOS counts reclaimable cache as used memory, so
  only its load is gated; Windows reports no load average, so only its memory is.
- Nested gated calls run immediately, identified by a marker the gate sets in
  the admitted command's environment. Fairness is not promised.
- Measure admission overhead alongside contention; the earlier 37 ms figure
  included the removed systemd probe.

## Related

- [Recoverable worktrees](/quest/m0/worktree.md) - owns command descendants, with its own process-ownership backend
- [Own-PC runner](/quest/m0/kix/runner.md) - can gate expensive job phases on host room
