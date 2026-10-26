# [S] Codex agents release their checkouts

## Goal

A Codex agent that `quest agent` starts runs inside `quest worktree run`, so
its checkout is released when the agent exits and restored when it resumes,
without waiting for the parent chat to end or the PR to merge. Codex app
threads stay on Codex's native archive.

## Plan

Split 2026-10-26 from [Agent lifecycle integration](/quest/m0/worktree-agents.md),
since it does not depend on the Claude hooks; the decision is recorded there.

- Decided 2026-10-26 (user): Codex documents no worktree hooks, only a
  recoverable archive and a 15-worktree retention, so `quest agent` runs the
  harness inside `quest worktree run`, which releases on exit and restores on
  resume. Codex app threads stay on Codex's native archive.
- Exercise a finished agent, a suspended decision, a crash, and a resumed
  session, and confirm each checkout is released or restored.

## Related

- [Agent lifecycle integration](/quest/m0/worktree-agents.md) - the Claude side of checkout release
- [Headless agents](/quest/m0/helpers/headless-agents.md) - `quest agent` start, resume, and stop
