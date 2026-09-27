# First public release

## Goal

Ship Quest v0.1.0. A developer using Claude Code or Codex with GitHub pastes one
line into their agent to set Quest up in any repository, plans and runs agent
work through quests, and can remove it without losing their own content.
macOS and Linux (WSL) only; native Windows is m1.

## Plan

Decided while planning m0 (2026-09-26), replacing the earlier copied-files and
ownership-manifest design:

- Nothing is vendored. The binary carries the skills and the quest contract;
  a repository gets static one-line skill stubs and one reference line in its
  root instructions. Upgrading never rewrites repository files.
- The repository's own tool manager pins the version: mise (release binaries,
  or a git rev for dogfooding) or a nix flake input. Quest ships no launcher
  and no pin file; an install outside either is simply unpinned.
- The CLI stays offline. Anything touching GitHub (issue import and export,
  claims, merging) lives in skills.
- Repository-specific rules stay in the repository's own root instructions.

## Quests

- [Embedded skills](/quest/m0/embedded-skills.md) - `quest skill <name>` and `quest guide` serve the skills and contract from the binary
- [Release binaries](/quest/m0/releases.md) - tagged releases publish macOS and Linux binaries that mise and a shell installer can fetch
- [Init and uninstall](/quest/m0/init.md) - `quest init` sets a repository up with stubs and a root reference; `quest uninstall` reverses it
- [Export skill](/quest/m0/export.md) - turn active quests back into GitHub issues before leaving Quest
- [Setup guide](/quest/m0/setup.md) - one line pasted into an agent installs, pins, and initializes Quest, or removes it
- [Migrate moq and moq.pro](/quest/m0/migrate-moq.md) - replace their `.quest` submodules with `quest init` and a pinned binary
- [Release proof](/quest/m0/release-proof.md) - a fresh repository completes the whole lifecycle in CI, then v0.1.0 is tagged
- [Launch material](/quest/m0/launch.md) - README, quickstart, demo, comparison, and launch-post drafts
