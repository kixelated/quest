# [S] Write the setup guide

## Goal

A `SETUP.md` at the repository root that an agent follows when a user pastes one
line from the README (for example "Follow
https://github.com/kixelated/quest/blob/main/SETUP.md to set up Quest here").
It installs and pins the binary, runs `quest init`, and adapts the repository's
root instructions. The same file covers removal.

## Plan

- Replaces a setup skill: an adopter has no skills before init, so a pasted
  prompt is the bootstrap.
- Pinning: prefer the repository's existing tool manager (mise `github:`
  backend, or a flake input for nix repositories), falling back to the shell
  installer with the user's consent.
- Removal: run the export skill, `quest uninstall`, then drop the pin.
- Written for an agent to execute and a human to audit; keep it short.
