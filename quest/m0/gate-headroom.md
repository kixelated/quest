# [M] Admit gated commands at once while the host has room

## Goal

`quest gate` adds no noticeable delay while the host has room, and still
spaces admissions out as the host nears its CPU or memory limit. A burst of
gated `just test` runs on an idle host starts together, instead of about
10 seconds apart.

## Plan

Decided 2026-10-21 (user) after the contention measurements in
[kixelated/quest#177](https://github.com/kixelated/quest/pull/177), reproducible
with `scripts/gate-bench.sh`. On a 24-core host, Worker suites only timed out
at about 8 suites per CPU, where the gate prevented the failures at about
1.3× the ungated makespan. With room to spare, the gate only added waiting: a
burst of 8 took 104 s gated versus 19 s ungated.

- **Admit with headroom (user).** The load average and free memory both lag
  new work, so count each admission from the last minute as one more unit of
  load and as one command's memory budget taken from available memory. Then:
  1. Admit at once while load plus recent admissions stays under the CPU
     count, and available memory minus the recent admissions' budgets still
     covers one command.
  2. Once recent admissions tip either measure over, but the load alone is at
     or under the CPU count and available memory alone covers one command,
     admit one command at a time, `SETTLE_MS` apart. Spaced admissions count
     as recent too.
  3. Otherwise wait, as today.

  This reverses the 2026-10-15 "no adaptive scheduler" decision. Memory
  admission stays, because heavier repositories (Rust builds) are what risk
  OOM; counting recent admissions against it keeps a burst from passing on
  one shared free-memory sample. Rejected: fixing the spacing only, taking
  the gate out of `just check` and `just test`, and keeping today's delay.
- **Admission requirements.** Today a claim is one `O_EXCL` file per 5-second
  window, and each admission deletes the older ones; the replacement for
  `Host.claim(window)` is left to the implementation, which must meet these:
  - Count and claim atomically across processes, with several admissions per
    window and each admission remembered for a minute.
  - Never admit past the three-band rule, and always admit some waiter when
    the rule has room.
  - Recover from a caller that crashes mid-admission on every platform the
    gate runs on, without blocking admission indefinitely.
  - Bound the effect of a wall-clock step in either direction to about one
    record lifetime.
  - Space band-2 admissions at least `SETTLE_MS` apart, measured from the
    previous admission's time (decision 8 in
    [kixelated/quest#128](https://github.com/kixelated/quest/pull/128)), with
    waiters waking when that interval ends rather than at the next window
    boundary, so queued commands stop starting about 10 s apart.
  - Update the README's "Gate expensive commands" admission paragraph and the
    `admit()` doc comment, which both describe today's behaviour.
- **Hazards to test.** Each came up in review of the plan in
  [kixelated/quest#180](https://github.com/kixelated/quest/pull/180):
  - A burst passing one shared free-memory sample, so every caller fits a
    budget that only one does.
  - A burst that all reads "0 recent" before any of them records.
  - Two admissions milliseconds apart across a window boundary.
  - Expired records leaving holes in numbered slots, so a slot number
    undercounts recent admissions.
  - Every caller in an over-capacity burst recording, seeing no room, and
    withdrawing, then repeating that together forever.
  - A dead lock holder's PID reused on macOS or Windows, where only Linux
    records a process start time, keeping the lock held indefinitely.
  - A backward clock step leaving records dated far in the future, which
    count as recent indefinitely or are discarded while still valid.
  - A forward clock step past the record lifetime, expiring records early and
    dropping their spacing and reservations.
  - `performance.now()` differing per process, and `CLOCK_MONOTONIC`
    restarting at boot while the fallback claim directory persists.
- **Stable claim directory.** Callers with and without `XDG_RUNTIME_DIR` use
  different claim directories today. Use `/run/user/<uid>/quest/gate` when
  `/run/user/<uid>` exists, otherwise `~/.cache/quest/gate/<hostname>` for
  shared home directories, so the choice depends only on the host, never on
  the caller's environment.
  `gate-bench.sh overhead` needs another way to get a fresh directory.
- **Ctrl-C once.** In both `quest gate` and `quest worktree run`
  (`src/cli/supervise.ts`), a terminal Ctrl-C reaches the child directly and
  again through the forwarder. Share one fix between them. On Unix, while
  Quest is in the terminal's foreground process group, skip forwarding SIGINT
  and SIGHUP, which the terminal also delivers to the child; always forward
  SIGTERM, which a terminal never sends.
  A SIGINT sent with `kill` to Quest alone is then not forwarded. On Windows,
  Ctrl-C reaches every process on the console and Node's `child.kill()`
  terminates the child forcefully, so `quest gate` waits for the child
  instead of forwarding; `quest worktree run` is Linux-only.
- Re-run `scripts/gate-bench.sh` for the idle-burst and 8× cases and record
  both results in the PR. Expect the pinned 8× case to look ungated: it
  confines 16 suites to two CPUs with `taskset`, while headroom is measured
  across the host, so most start at once and the timeouts from
  [kixelated/quest#177](https://github.com/kixelated/quest/pull/177) likely
  return. That follows from the decision and is not a regression.

## Related

- [Agent lifecycle integration](/quest/m0/worktree-agents.md) - removes agent-count throttles once resource control is in place
