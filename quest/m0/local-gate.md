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
  simple configurable concurrency limit, with a CPU-count default. Repository
  entrypoints invoke the gate automatically; ordinary reasoning and I/O do not
  occupy a CPU slot. No adaptive scheduler or new daemon is needed for this scope.
- Decided 2026-10-15 (user): gate checks and CI-like suites on host load, not
  agents, because load from every session and user is what starves test timers.
  The agent-level load-average rule was removed from the spawn and complete skills.
- Decided 2026-10-15 (user): admission uses both limits. Slots cap concurrency
  where the platform can own descendants exactly; admission also waits while the
  1-minute load average exceeds the core count, which sees work the slots cannot.
- Decided 2026-10-15 (user): the load gate runs on every platform, and Linux adds
  systemd scope slots on top. macOS, Windows, and Linux without a user manager
  get load-only admission rather than an unsupported error. Windows reports no
  load average, so admission there is immediate.
- Decided 2026-10-15 (user): Bun's `--no-orphans` stays a research option. Its
  best-effort registration and bounded PID-tree walks do not establish exact
  ownership by themselves.
- Decided 2026-10-15: at most one admission per 5-second window across all
  callers, claimed by exclusively creating a per-window file. The load average
  lags new work and is sampled every 5 seconds, so waiters that all see it fall
  must not start together. Nothing is held across the command, so a crash
  leaves no stale lock.
- Decided 2026-10-15: lowering `jobs` while commands run is safe: each admission
  reads the limits when it starts waiting, and higher slots finish undisturbed.
- Nested gated calls run immediately: the kernel scope identifies them on Linux,
  and an inherited marker does where admission was by load alone.
- A 10-sample probe measured about 37 ms of admission overhead for a gated
  `/bin/true`. Fairness is not promised.

## Related

- [Recoverable worktrees](/quest/m0/worktree.md) - should reuse the systemd scope backend for exact descendant ownership
- [Own-PC runner](/quest/m0/kix/runner.md) - reuse local command supervision
