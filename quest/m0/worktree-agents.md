# [M] Release agent checkouts at handoffs and completion

## Goal

Quest workflows use recoverable worktree ownership through supported Codex and
Claude lifecycle integrations. A completed or suspended worker releases its
checkout without waiting for the parent chat to end or the PR to merge.

## Plan

- Decided 2026-10-15: use `quest worktree` for checkout lifetime and `quest gate`
  for expensive phases. Remove the skill's physical-core agent-count and load
  average admission rules once command admission is integrated. Disk capacity
  gates checkout allocation, not the number of reasoning agents.
- A foreground CLI wrapper only owns its child commands. Native agent tools
  need explicit ownership and suspend/resume integration; a helper that exits
  after creating a directory cannot infer when such an agent has finished.
- Reuse native worktree/archive APIs where they preserve the required state.
  Test actual completion, not merely an accepted or queued archive request.
  Recover failed archives and stale ownership without bypassing active locks.
- Do read-only discovery without allocating a new checkout when existing
  context suffices. Reuse suitable owned checkouts for active work.
- Update shared workflow guidance to checkpoint meaningful source before a
  blocking decision or completed handoff, recording unresolved work and check
  results. Exclude disposable scratch and preserve source on cancellation.
- Exercise both harnesses with a finished worker under a still-live parent,
  a suspended decision, a crash, and a restored session. Reconcile existing
  cleanup mechanisms instead of adding an unrelated competing sweeper.
- Current Claude docs exclude hook-created subagent worktrees from automatic
  removal and its retention sweep. Codex can archive recoverably but refuses
  unsupported nested repositories. Integrate their actual supported lifecycle.
  Sources: [Claude worktrees](https://code.claude.com/docs/en/worktrees),
  [Claude removal hooks](https://code.claude.com/docs/en/hooks#worktreeremove),
  [Codex worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees).

## Required

- [Recoverable worktrees](/quest/m0/worktree.md) - checkpoint, release, and restore
- [Expensive command gate](/quest/m0/local-gate.md) - resource control before removing agent-count throttles

## Related

- [Own-PC runner](/quest/m0/kix/runner.md) - reuse lifecycle ownership in the hosted job adapter
