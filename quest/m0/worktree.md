# [L] Checkpoint and release worktrees with quest worktree

## Goal

`quest worktree` owns a recoverable checkout lifecycle: admit disk use, create
or reuse a checkout, run work, checkpoint, release, and restore on resume.
Waiting for a decision or PR review does not require retaining a large checkout.
Agent count is unrestricted by this command; expensive work uses `quest gate`.

## Plan

- Decided 2026-10-15: disk capacity is the admission constraint. Account for
  concurrent allocations and expected build growth, with configurable limits
  informed by measured footprints. A free-space check alone cannot reserve
  space against simultaneous creators or subsequent builds.
- Checkpoint meaningful edits before a blocking handoff and at completion,
  then release the idle checkout. An asynchronous question with independent
  work still running is not a release boundary. Checkpoints are recoverable
  WIP, not claims of passing tests, and do not run the validation suite.
- Preserve source, unique commits, and resume metadata independently of the
  checkout before removing it. Preserve local-only submodule history outside
  its disposable gitdir. Keep valuable untracked or ignored files explicitly;
  never publish secrets or treat every ignored file as disposable.
- Record unresolved work and which checks passed or were not run with each
  checkpoint. Recovery metadata lives outside the disposable checkout.
- Delete owned disposable scratch at handoff or exit. If scratch must live in
  a checkout, ignore its declared paths and teach cleanup those same paths.
  Unstaged source changes are work to preserve, not scratch to delete.
- Own foreground child processes until they stop; only then release capacity
  and remove their checkout. Record ownership so crashes can be reconciled.
  Reuse the owning tool for managed worktrees and report failed cleanup as a
  retained allocation, not success. Do not steal live locks or remove shared
  or current checkouts underneath their users.
- Preserve branches/recovery refs independently of checkout retention. A
  squash-merged branch may not be an ancestor of main; exact PR-head evidence
  matters when deciding whether a published result is finished.
- Verify checkpoint/restore across dirty files, unique commits, submodules,
  cancellation, interrupted cleanup, and simultaneous disk admission. Measure
  retained disk after complete and suspended jobs; update existing docs inline.

Draft implementation status:

- Draft implementation: explicit disk capacity/reservation, generic Git-owned
  create/checkpoint/release/restore, private recovery metadata, full bundles,
  tracked/index preservation, explicit keep/scratch classification, initialized
  submodule history, retained failed allocations, and filesystem fixtures.
- Remaining before this quest is complete: exact foreground descendant ownership
  through cancellation/crashes and automatic reconciliation, interrupted create
  and restore recovery, automatic release at lifecycle boundaries, concurrency
  and cancellation fixtures, and measured real-job retained footprints. Native
  agent lifecycle adoption remains in the related integration quest.
- Process groups and PID files cannot prove detached descendants are stopped
  after a supervisor crash. Keep this PR draft until a supported ownership
  backend can enforce that boundary; unsupported platforms must fail explicitly.

## Related

- [Expensive command gate](/quest/m0/local-gate.md) - independent CPU admission
- [Agent lifecycle integration](/quest/m0/worktree-agents.md) - native agents and workflow adoption
