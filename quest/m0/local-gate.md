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
- The quest remains unfinished. Automatic repository entrypoint adoption needs
  a platform policy: recommended next step is explicit Linux support first,
  retaining a clear unsupported error on macOS and Windows until native ownership
  backends are justified. Do not install an unconditional gate in cross-platform
  entrypoints or silently run an unsupported gate ungated.
- The pinned Bun exposes `--no-orphans`, but its best-effort registration and
  bounded PID-tree walks need further validation before relying on it for exact
  ownership. Windows ownership can use native Job Objects; portable Node
  process groups do not provide the required crash and descendant guarantees. A broader backend choice
  and its packaging remain open. No native helper is added in this draft.
- A 10-sample local bundled-CLI probe measured median startup of 35.5 ms for
  `--version` and 72.5 ms for a gated `/bin/true` (about 37 ms additional).
  This is an admission-cost probe on the current loaded host, not a whole-machine
  responsiveness result. Representative build/test contention remains unmeasured.
- Shared configuration must remain consistent while slots are active. Safe
  configuration changes across active callers and representative build/test
  contention measurements remain unfinished. Fairness is not promised by this
  simple admission implementation.

## Related

- [Recoverable worktrees](/quest/m0/worktree.md) - disk admission and checkout lifetime
- [Own-PC runner](/quest/m0/kix/runner.md) - reuse local command supervision
