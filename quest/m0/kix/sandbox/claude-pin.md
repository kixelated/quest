# [XS] Bump the runner's pinned Claude Code

## Goal

The runner's Nix closure pins Claude Code 2.1.305 or later instead of
2.1.291, and the sandbox's behaviour the README documents matches the pinned
version.

## Plan

Decided 2026-10-24 (user) as a follow-up of
[kixelated/quest#212](https://github.com/kixelated/quest/pull/212), whose live
boundary test passed on both 2.1.291 and 2.1.305:

- Bump the pin in `flake.nix` (`QUEST_RUNNER_CLAUDE`) and rerun the runner
  tests. Check the sandbox settings the runner passes (`dontAsk`,
  `--setting-sources user`, the MCP tool timeout) against the new version's
  docs and changelog.
- Ranked first in the epic: the later children build on the pinned version.
