# [M] Migrate moq and moq.pro to quest init

## Goal

moq-dev/moq and moq-dev/moq.pro run Quest the way any adopter does: a pinned
binary plus `quest init` stubs, with no `.quest` submodule, no `just quest`
wrapper, and no quest skills left in kixelated/skills.

## Plan

- The submodule layout (moq-dev/moq#4252, moq-dev/moq.pro#1942) is the interim
  step that removed their forks.
- Pin through their flakes (both are nix repositories), at a release or a git
  rev while dogfooding.
- Remove merge, spawn-merge, and close from kixelated/skills and repoint both
  repositories' symlinks; they now come from Quest.
- Keep each repository's quest-specific rules (moq's `dev` branch handling) in
  its root instructions, and its CI hooks calling `quest check`.

## Required

- [Init and uninstall](/quest/m0/init.md) - the stubs and root line come from init
