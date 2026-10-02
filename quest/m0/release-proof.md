# [M] Prove the lifecycle and tag v0.1.0

## Goal

CI takes a fresh repository through install, `quest init`, a planned quest,
`quest check`, `quest ready`, and `quest uninstall`, and verifies nothing the
user owned was lost. Then v0.1.0 is tagged and published, and its release
installs through mise and the shell installer on macOS and Linux.

## Plan

- The CLI half runs scripted in CI on macOS and Linux. The agent half (setup
  guide, export skill) is verified once by hand against a scratch repository,
  with the transcript kept for the launch demo.
- Include a repository that already has an `AGENTS.md` or `CLAUDE.md` and
  a same-named skill, to prove init refuses rather than overwrites.
- There's no rc tag. The install check's run on v0.1.0 gates this quest, and a
  broken install ships as a fixed v0.1.x.

## Required

- [Install check](/quest/m0/install-check.md) - proves the v0.1.0 release installs
