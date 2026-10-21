# [S] Measure quest gate under representative contention

## Goal

`quest gate <cmd>` admits a bounded number of expensive commands for one user
on one host, shared across repositories and worktrees. Concurrent agent sessions
remain useful without multiplying full-machine builds and test stacks.

The gate and its automatic use by `just check` / `just test` have landed. What
remains is measuring representative build/test contention with and without the
gate, for example how many concurrent Worker suites hit their 5-second timeouts,
before claiming a responsiveness improvement.

## Plan

- Decided 2026-10-15: gate expensive command phases, not agent lifetimes. Use a
  simple concurrency limit derived from the host. Repository
  entrypoints invoke the gate automatically; ordinary reasoning and I/O do not
  occupy a CPU slot. No adaptive scheduler or new daemon is needed for this scope.
- Decided 2026-10-15 (user): gate checks and CI-like suites on host load, not
  agents, because load from every session and user is what starves test timers.
  The agent-level load-average rule was removed from the spawn and complete skills.
- Decided 2026-10-15 (user): admission uses both. Slots cap concurrency where
  the platform can own descendants exactly; admission also waits while the
  1-minute load average exceeds the core count, which sees work the slots cannot.
- Decided 2026-10-15 (user): the load gate runs on every platform, and Linux adds
  systemd scope slots on top. macOS, Windows, and Linux without a user manager
  get load and memory admission alone rather than an unsupported error.
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
  2026-10-21 from the usable core count). Each
  command is budgeted 4 GiB, a typical build or test stack, so Linux gets
  `min(usable cores, RAM / 4 GiB)` slots (at least one), with RAM capped by a cgroup
  memory limit. Admission also waits while available memory is below
  `min(4 GiB, RAM / 4)`, so a small host still runs one command. Cgroup
  headroom subtracts inactive file cache from usage, since it is reclaimable. macOS counts
  reclaimable cache as used memory, so only its load is gated; Windows reports
  no load average, so only its memory is.
- Nested gated calls run immediately: the kernel scope identifies them on Linux,
  and an inherited marker does where admission had no kernel scope.
- A 10-sample probe measured about 37 ms of admission overhead for a gated
  `/bin/true`. Fairness is not promised.

## Related

- [Recoverable worktrees](/quest/m0/worktree.md) - should reuse the systemd scope backend for exact descendant ownership
- [Own-PC runner](/quest/m0/kix/runner.md) - reuse local command supervision
