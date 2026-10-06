# First public release

## Goal

Ship Quest v0.1.0. A developer using Claude Code or Codex with GitHub pastes one
line into their agent to set Quest up in any repository, plans and runs agent
work through quests, and can remove it without losing their own content.
macOS and Linux (WSL) only; native Windows is m1.

The launch includes Quest on Cloudflare. Outside contributors lock quests and
donate agent tokens to run them, and the result is reviewed and merged in a
web UI that syncs with GitHub. It is also the entry for Cloudflare's
competition, due 2026-10-14.

## Plan

Decided while planning m0 (2026-09-26), replacing the earlier copied-files and
ownership-manifest design:

- Nothing is vendored. The binary carries the skills and the quest contract;
  a repository gets static one-line skill stubs and one reference line in its
  root instructions. Upgrading never rewrites repository files.
- The repository's own tool manager pins the version: mise (release binaries,
  or a git rev for dogfooding) or a nix flake input. Quest ships no launcher
  and no pin file; an install outside either is simply unpinned.
- The CLI is offline except `quest run` (amended 2026-10-01 for Quest on
  Cloudflare). Anything touching GitHub (issue import and export, branch
  claims, merging) lives in skills.
- Repository-specific rules stay in the repository's own root instructions.

## Required

- [Quest on Cloudflare](/quest/m0/cloudflare/README.md) - contributors lock quests and donate tokens to run them; maintainers review and merge in a web UI synced with GitHub
- [Quest log theme](/quest/m0/theme/README.md) - an MMO-style identity, copy, board, landing page, and CLI output for the demo and launch
- [Spawn skips finished line children](/quest/m0/spawn-line-children.md) - `/quest-spawn` offers no quest already finished on its line branch, and spawned agents keep scratch files apart
- [Release proof](/quest/m0/release-proof.md) - a fresh repository completes the whole lifecycle in CI, then v0.1.0 is tagged
- [Launch material](/quest/m0/launch.md) - README, quickstart, demo, comparison, and launch-post drafts
