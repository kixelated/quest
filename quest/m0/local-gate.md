# [M] Bound expensive commands with quest gate

## Goal

`quest gate <cmd>` admits a bounded number of expensive commands for one user
on one host, shared across repositories and worktrees. Concurrent agent sessions
remain useful without multiplying full-machine builds and test stacks.

## Plan

- Decided 2026-10-15: gate expensive command phases, not agent lifetimes. Use a
  simple configurable concurrency limit, with a CPU-count default. Repository
  entrypoints invoke the gate automatically; ordinary reasoning and I/O do not
  occupy a CPU slot. No adaptive scheduler or new daemon is needed for this scope.
- Wait before launching the command, its stack, or its test timeout clocks.
  Preserve arguments, terminal I/O, exit status, and cancellation. Nested gated
  calls must not deadlock or silently multiply the admitted concurrency.
- A slot remains owned while expensive descendants run. Cover interruption,
  crashes, concurrent acquisition, and recovery without relying on stale PID
  guesses. Unsupported ownership semantics fail explicitly.
- Reuse existing compiler scheduling such as mbx; this is admission for whole
  expensive phases, not a replacement compiler scheduler. Internal worker
  concurrency remains a separate consumer responsibility.
- Exercise contention across processes and repositories, cancellation, nesting,
  and exact exit propagation with small fixtures. Measure admission overhead
  and representative contention before claiming a responsiveness improvement.
- Update CLI help and existing usage docs inline. Keep the shared primitive
  outside repository-specific policy and independent of the hosted runner.

### Implementation status

- The draft implements a Linux/systemd user-scope backend, transparent CLI
  invocation, configurable admission, nested scope reuse, exact cgroup-handle
  cancellation, and event-driven contention waiting. Kernel scopes retain slots
  through supervisor crashes and detached descendants.
- Decided 2026-10-15 (user): gate checks and CI-like suites on host load, not
  agents. The agent-level load-average rule was removed from the spawn and
  complete skills.
- Configuration changes are safe while commands run: each admission reads the
  limit when it starts waiting, and commands in higher slots finish undisturbed
  after the limit is lowered.
- Open: whether admission uses fixed per-user slots, the host load average
  (which includes other users and sessions), or both. The systemd ownership
  backend is only needed for slots; [Recoverable worktrees](/quest/m0/worktree.md)
  needs the same exact descendant ownership and should reuse it either way.
- Open: the platform policy for automatic entrypoint adoption (`just check`,
  `just test`). Explicit Linux support is recommended first, keeping a clear
  unsupported error on macOS and Windows until native backends are justified.
  Do not silently run an unsupported gate ungated. The pinned Bun's
  `--no-orphans` does not establish exact ownership by itself (best-effort
  registration, bounded PID-tree walks); Windows could use Job Objects.
- Unfinished: representative build/test contention measurements, once the
  admission policy and adopted entrypoints are settled. A 10-sample probe
  measured about 37 ms of admission overhead for a gated `/bin/true`.
  Fairness is not promised.

## Related

- [Recoverable worktrees](/quest/m0/worktree.md) - disk admission and checkout lifetime
- [Own-PC runner](/quest/m0/kix/runner.md) - reuse local command supervision
