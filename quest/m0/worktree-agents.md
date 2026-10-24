# [M] Release agent checkouts at handoffs and completion

## Goal

Quest workflows use `quest worktree` checkout ownership through supported
Codex and Claude lifecycle integrations. A completed or suspended worker
releases its checkout without waiting for the parent chat to end or the PR to
merge.

## Plan

- Decided 2026-10-15: use `quest worktree` for checkout lifetime and `quest gate`
  for expensive phases. Disk capacity gates checkout allocation, not the number
  of reasoning agents.
- Landed: `quest worktree run` supervises a job and releases its scratch,
  `remove` deletes a finished checkout without losing work (a squash-merged
  head counts only with exact PR-head evidence), and `stop` ends a crashed
  supervisor's leftover processes. The guide routes expensive commands through
  `quest gate`, asks for a checkpoint before a blocking decision or handoff,
  and keeps read-only discovery out of new checkouts; the spawn and complete
  skills no longer cap agents by core count.
- Measured 2026-10-23: this repository's main checkout held 65 Claude subagent
  worktrees under `.claude/worktrees/`, 8.2 GB in all, the oldest from
  2026-10-07, so finished workers are not reclaimed today.
- A foreground CLI wrapper only owns its child commands. Native agent tools
  need explicit ownership and suspend/resume integration; a helper that exits
  after creating a directory cannot infer when such an agent has finished.
- Reuse native worktree/archive APIs where they preserve the required state.
  Test actual completion, not merely an accepted or queued archive request.
  Recover failed archives and stale ownership without bypassing active locks.
- Claude: a `WorktreeCreate` hook replaces every worktree Claude creates in the
  repository (`--worktree`, `EnterWorktree`, subagent isolation, background and
  remote-control sessions) and prints the path; `.worktreeinclude` is then not
  processed. Claude never removes a hook-created subagent or workflow worktree
  and never runs `WorktreeRemove` for one; it runs `WorktreeRemove` only for
  session exits, `ExitWorktree`, background-session deletes, and remote-control
  cleanup. `SubagentStop` fires when a subagent finishes responding, which
  covers both completion and a suspended decision, and `SubagentStart` fires on
  resume; their `cwd` follows the agent, but whether it is the subagent's
  worktree must be confirmed live. Without a hook, Claude removes a clean
  subagent worktree only when it finishes with no changes and otherwise leaves
  it to the `cleanupPeriodDays` sweep.
- Codex can archive recoverably but refuses unsupported nested repositories,
  and keeps its 15 most recent managed worktrees by default. Integrate its
  actual supported lifecycle.
  Sources: [Claude worktrees](https://code.claude.com/docs/en/worktrees),
  [Claude removal hooks](https://code.claude.com/docs/en/hooks#worktreeremove),
  [Codex worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees).
- Open: whether `quest init` installs the Claude hooks into the repository's
  settings or the user installs them; how a hook-created checkout learns its
  reservation and scratch paths; and what an unset capacity admits, since
  `quest worktree create` refuses everything until `capacity` is set.
- Exercise both harnesses with a finished worker under a still-live parent,
  a suspended decision, a crash, and a restored session. Reconcile existing
  cleanup mechanisms instead of adding an unrelated competing sweeper. Run
  these from a session that is not itself worktree-isolated: Claude's
  isolation checks refuse git in any other repository, including a scratch
  test repository.
