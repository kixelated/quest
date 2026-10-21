# [M] Own worktree processes and release checkouts automatically

## Goal

`quest worktree` supervises the commands that run in a checkout it created,
then checkpoints and releases that checkout automatically once they stop.
A crash or cancellation is reconciled without losing work, stealing a live
lock, or removing a checkout whose processes may still be running.

## Plan

- Landed in [kixelated/quest#127](https://github.com/kixelated/quest/pull/127):
  manual disk capacity/reservation, create, checkpoint, release, and restore of
  Git-owned checkouts, with private recovery data, interrupted-transition
  recovery through `restore`/`release`, and filesystem fixtures. The README
  section "Recoverable local checkouts" documents it as experimental and
  tells users to stop all work before checkpointing or releasing.
- Decided (user): reuse the Linux systemd scope ownership backend from
  [kixelated/quest#128](https://github.com/kixelated/quest/pull/128) rather than
  adding another one; start once that PR merges. Process groups and PID files
  cannot prove detached descendants stopped after a supervisor crash, so hosts
  without a supported backend fail explicitly instead of guessing.
- Own foreground child processes and their descendants until they stop; only
  then release capacity and remove the checkout. Record ownership so a crash
  can be reconciled, including a stale registry lock whose owner has exited.
  Report failed cleanup as a retained allocation, not success.
- Release automatically at lifecycle boundaries: checkpoint meaningful edits
  before a blocking handoff and at completion, then release the idle checkout.
  An asynchronous question with independent work still running is not a release
  boundary. Delete declared scratch at handoff or exit; unstaged source changes
  are work to preserve, not scratch.
- Keep branches and recovery data independent of checkout retention. A
  squash-merged branch may not be an ancestor of main; only exact PR-head
  evidence shows a published result is finished.
- Add cancellation and crash fixtures: interrupt a supervised command with live
  descendants, kill the supervisor, and reconcile. Measure retained disk after
  complete and suspended jobs (2026-10-15 baseline on this repository: 1.6 MB
  fresh, 376 MB built, 4.4 MB released checkpoint, ~0.6 s restore).
- Native agent lifecycle adoption stays in the agent integration quest.

## Related

- [Expensive command gate](/quest/m0/local-gate.md) - its Linux ownership backend is reused here
- [Agent lifecycle integration](/quest/m0/worktree-agents.md) - native agents and workflow adoption
