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

- The binary carries the skills, the quest contract, and all hook logic.
  `quest init` installs only static stubs into a repository: one-line skill
  stubs, one reference line in its root instructions, one `.gitattributes`
  line, and Claude hook entries in `.claude/settings.json` that only call a
  `quest` subcommand. Upgrading never rewrites repository files. (Amended
  2026-10-26 (user), replacing "Nothing is vendored", so `quest init` can
  install the agent lifecycle hooks.)
- The repository's own tool manager pins the version: mise (release binaries)
  or a nix flake input (any rev, built from source). Quest ships no launcher
  and no pin file; an install outside either is simply unpinned.
- The CLI may call GitHub (amended 2026-10-07, replacing "offline except
  `quest run`" after agents' hand-rolled polling tripped GitHub's rate
  limits). Prefer offline, deterministic commands, and keep GitHub calls in
  the CLI rather than skill prose.
- Repository-specific rules stay in the repository's own root instructions.

## Required

- [Kix decision UI](/quest/m0/kix/README.md) - planning and implementation through prompts and summaries, run on the maintainer's own runners
- [Gate bench](/quest/m0/gate-bench.md) - measure headroom admission on an idle host
- [Agent lifecycle integration](/quest/m0/worktree-agents.md) - reclaim completed and suspended Claude checkouts through its hooks
- [Agent workflow helpers](/quest/m0/helpers/README.md) - CLI commands for CI waits, PR status, claims, quest moves, and serialized merges
- [Quest log theme](/quest/m0/theme/README.md) - an MMO-style identity, copy, board, landing page, and CLI output for the demo and launch
- [Launch material](/quest/m0/launch.md) - README, quickstart, demo, comparison, and launch-post drafts
