# First public release

## Goal

Ship Quest v0.1.0. A developer using Claude Code or Codex with GitHub pastes one
line into their agent to set Quest up in any repository, plans and runs agent
work through quests, and can remove it without losing their own content.
macOS and Linux (WSL) only; native Windows is a1.

The launch includes Quest on Cloudflare. Outside contributors lock quests and
donate agent tokens to run them, and the result is reviewed and merged in a
web UI that syncs with GitHub. It is also the entry for Cloudflare's
competition, due 2026-10-14.

## Plan

Decided while planning a0 (2026-09-26), replacing the earlier copied-files and
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

- [Quest on Cloudflare](/quest/a0/cloudflare/README.md) - contributors lock quests and donate tokens to run them; maintainers review and merge in a web UI synced with GitHub
- [Quest log theme](/quest/a0/theme/README.md) - an MMO-style identity, copy, board, landing page, and CLI output for the demo and launch
- [Release checks on CLI PRs](/quest/a0/release-pr-paths.md) - the Release workflow's native binary checks run on `src/**` pull requests
- [Atomic init](/quest/a0/init-atomic.md) - init refuses before writing on path-type conflicts too
- [Path collisions](/quest/a0/path-collision.md) - `quest check` flags a quest and an epic that share a path
- [Link decoding](/quest/a0/link-decode.md) - the core percent-decodes link targets, so names with `#`, `%`, or spaces can be linked
- [PR waits](/quest/a0/wait.md) - `quest wait` blocks until a PR has new activity, replacing the skills' hand-rolled polling
- [Launch material](/quest/a0/launch.md) - README, quickstart, demo, comparison, and launch-post drafts
