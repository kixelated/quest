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

## Related

- [Worktree process ownership](/quest/m0/worktree.md) - reuses this ownership backend for checkout commands
- [Own-PC runner](/quest/m0/kix/runner.md) - reuse local command supervision
