# [M] Prove the lifecycle and tag v0.1.0

## Goal

CI takes a fresh repository through install, `quest init`, a planned quest,
`quest check`, `quest ready`, and `quest uninstall`, and verifies nothing the
user owned was lost. Then v0.1.0 is tagged and published, and its release
installs through mise and the shell installer on macOS and Linux.

## Plan

Only the maintainer's v0.1.0 tag and its live verification remain:

- Before tagging, confirm the EPIPE fix
  ([#81](https://github.com/kixelated/quest/pull/81)) has merged into `main`
  (decided 2026-10-07; it merged the same day).
- Tag v0.1.0 from `main` with the steps in
  [#82](https://github.com/kixelated/quest/pull/82). The Release workflow's
  install checks on that tag gate this quest, and it closes once they pass.
  There's no rc tag; a broken install ships as a fixed v0.1.x (reaffirmed
  2026-10-07).
- Decided 2026-10-07: a live `/quest-export` run does not gate this quest.

Done, and kept for the record:

- CLI lifecycle coverage runs in CI (`scripts/lifecycle-check.sh`): on Linux
  and macOS from the flake's source build, and on every release target's
  native runner from the Bun-compiled binary. The full repository check stays
  on Ubuntu. Init refuses a same-named skill before writing anything.
- The setup and export-preparation rehearsal against the compiled binaries,
  installed through the shell installer and mise from a local copy of the
  release, ran on 2026-10-07. Its transcript, for the launch demo, is the
  description of [#82](https://github.com/kixelated/quest/pull/82).
