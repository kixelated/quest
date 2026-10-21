# [S] Admit gated commands at once while the host has room

## Goal

`quest gate` adds no noticeable delay while the host has room, and still
spaces admissions out as the host nears its CPU or memory limit. A burst of
gated `just test` runs on an idle host starts together, instead of about
10 seconds apart.

## Plan

Decided 2026-10-21 (user) after the contention measurements in
[kixelated/quest#177](https://github.com/kixelated/quest/pull/177), reproducible
with `scripts/gate-bench.sh`. On a 24-core host, Worker suites only timed out
at about 8 suites per CPU, where the gate prevented the failures for about
1.3× the total time. With room to spare, the gate only added waiting: a burst
of 8 took 104 s gated versus 19 s ungated.

- **Admit with headroom (user).** Admit at once while the host's load plus the
  admissions it has not yet reflected stays under the CPU count. The load
  average lags new work, so count each admission from the last minute as
  load. Space admissions one window apart only near the limit. This reverses
  the 2026-10-15 "no adaptive scheduler" decision; memory admission is
  unchanged, because heavier repositories (Rust builds) are what risk OOM.
  Rejected: fixing the spacing only, taking the gate out of `just check` and
  `just test`, and keeping today's delay.
- **One window apart, not two.** A claim is refused while the previous
  window's claim exists, and every waiter wakes at the same boundary, so
  queued commands start about 10 s apart. Space them one 5-second window apart
  as originally decided. Update the README's spacing sentence.
- **Stable claim directory.** Callers with and without `XDG_RUNTIME_DIR` use
  different claim directories today. Derive one per-user directory that every
  caller agrees on (for example from the uid), and keep the per-hostname
  fallback for shared home directories. `gate-bench.sh overhead` needs another
  way to get a fresh directory.
- **Backward clock steps.** A wall clock stepping back across a window
  boundary can allow one extra adjacent admission. Use a monotonic source, or
  also refuse while the next window's claim exists.
- **Ctrl-C once.** A terminal Ctrl-C reaches the child directly and again
  through the forwarder, in both `quest gate` and `quest worktree run`. Forward
  a signal only when the child would not already receive it (for example, skip
  forwarding while Quest is in the terminal's foreground process group), and
  share the fix between the two commands.
- Re-run `scripts/gate-bench.sh` for the idle-burst and 8× cases and record
  both results in the PR.

## Related

- [Worktree process ownership](/quest/m0/worktree.md) - `quest worktree run` shares the signal forwarding
- [Agent lifecycle integration](/quest/m0/worktree-agents.md) - removes agent-count throttles once resource control is in place
