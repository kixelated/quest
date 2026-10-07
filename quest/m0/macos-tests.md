# [XS] Run the CLI unit tests on macOS

## Goal

macOS CI runs the CLI's unit test suite again, so platform-specific
regressions (paths, symlinks, process spawning, case-insensitive filesystems)
fail CI before a release. Worker tests stay Linux-only, since they run in
workerd regardless of the host, and Windows stays in
[m1](/quest/m1/windows.md).

## Plan

Decided while planning on 2026-10-07, after the review of the TypeScript port
(#64) found the gap. Crane used to run `cargo test` in `nix flake check` on
every platform. Now `npm test` runs only in the Ubuntu `check` job, and the
macos-14 `lifecycle` job only runs `scripts/lifecycle-check.sh` against the
Nix build.

- Add `nix develop --command just install` and `nix develop --command npm test`
  (the root vitest suite only) as steps in the existing macos-14 `lifecycle`
  job. That keeps one macOS job on the same toolchain as Linux. A separate
  job, which would cost a second Nix setup, and a vitest checkPhase in the Nix
  package, which would need dev dependencies in the Nix build, were rejected.
- Fix any macOS-only failures this exposes at the root, or split them into
  follow-up quests if they're large.

## Related

- [Compiled releases](/quest/m0/cloudflare/release.md) - also edits CI; whichever lands second merges
