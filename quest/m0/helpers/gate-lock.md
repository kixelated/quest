# [S] Serialize commands with quest gate --lock

## Goal

`quest gate --lock <name> <cmd>` runs a command while holding a named
exclusive lock for one user on one host, so a local check-then-merge sequence
runs one at a time. It replaces the `~/.cache/moq-pro-merge.lock.d` mkdir
mutex that moq.pro agents invented (79 of 396 sessions).

## Plan

- Decided 2026-10-19 (user): a named exclusive lock rather than a general
  named semaphore with a limit.
- Hold it until the command and its descendants exit, and release it when
  the holder crashes, using an OS-held lock (or the Linux scope ownership
  from the gate) rather than PID guesses.
- The lock takes no CPU slot, so gated recipes inside the command still get
  normal admission instead of running as nested calls.
- While waiting, print the name and the holder's command and start time.
  Names are short tokens; reject anything that could escape the lock
  directory.
- Build on `src/cli/gate.ts` from [kixelated/quest#128](https://github.com/kixelated/quest/pull/128);
  start after that PR merges. Switching moq.pro to the lock is a follow-up
  in that repository.
- Data for the gate quests: the audit also counted 1,731 load-average
  polling commands in moq and moq.pro sessions since Oct 14, which the gate
  and the agent lifecycle quest remove.
- Test contention across processes, a crashed holder, cancellation while
  waiting, exit status propagation, and a gated recipe inside the lock.

## Related

- [Expensive command gate](/quest/m0/local-gate.md) - CPU admission the lock sits beside
