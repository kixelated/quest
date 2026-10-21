# First public release

## Goal

Ship Quest v0.1.0. A developer using Claude Code or Codex with GitHub pastes one
line into their agent to set Quest up in any repository, plans and runs agent
work through quests, and can remove it without losing their own content.
It runs on macOS, Linux, and native Windows.

The hosted launch is kix.quest, a cloud for creating software: maintainers
answer interactive prompts, from a phone-friendly web app with push
notifications, to plan issues, start ready quests, and act on new PRs. Their
own Linux and macOS runners do the work through Claude Code and opencode,
with any number of signed-in accounts, inside each project's Nix devShell.
The GitHub App bot publishes ordinary PRs. The contest no longer gates launch.
The standalone v0.1.0 CLI shipped on 2026-10-07; remaining work expands the
product without changing the core's independence.

## Plan

Decided while planning m0 (2026-09-26), replacing the earlier copied-files and
ownership-manifest design:

- Nothing is vendored. The binary carries the skills and the quest contract;
  a repository gets static one-line skill stubs and one reference line in its
  root instructions. Upgrading never rewrites repository files.
- The repository's own tool manager pins the version: mise (release binaries)
  or a nix flake input (any rev, built from source). Quest ships no launcher
  and no pin file; an install outside either is simply unpinned.
- The CLI may call GitHub (amended 2026-10-07, replacing "offline except
  `quest run`" after agents' hand-rolled polling tripped GitHub's rate
  limits). Prefer offline, deterministic commands, and keep GitHub calls in
  the CLI rather than skill prose.
- Repository-specific rules stay in the repository's own root instructions.

## Required

- [Expensive command gate](/quest/m0/local-gate.md) - shared CPU admission across worktrees and repositories
- [Recoverable worktrees](/quest/m0/worktree.md) - disk admission, checkpoints, release, and restore
- [Agent lifecycle integration](/quest/m0/worktree-agents.md) - reclaim completed and suspended checkouts through their harness
- [Agent workflow helpers](/quest/m0/helpers/README.md) - CLI commands for CI waits, PR status, claims, quest moves, and serialized merges

- [Kix decision UI](/quest/m0/kix/README.md) - planning and implementation through prompts and summaries, run on the maintainer's own runners
- [Quest log theme](/quest/m0/theme/README.md) - an MMO-style identity, copy, board, landing page, and CLI output for the demo and launch
- [Launch material](/quest/m0/launch.md) - README, quickstart, demo, comparison, and launch-post drafts
