# [S] Check release installs in CI

## Goal

After every published release, CI installs that release through
`mise use github:kixelated/quest@<tag>` and the release's
`quest-installer.sh` on macOS (arm64, x86_64) and Linux (x86_64, arm64), and
each installed `quest --version` matches the tag. A failure turns the run red;
the fix ships as the next patch release, not as an rc.

## Plan

- Use a reusable workflow (`.github/workflows/install-check.yml`, with
  `workflow_call` and `workflow_dispatch` taking a tag) that dist runs through
  `post-announce-jobs` in `dist-workspace.toml`, then regenerate `release.yml`
  with `dist generate`. A separate `release: published` trigger would never
  fire, because dist creates the release with `GITHUB_TOKEN`.
- Use native runners for all four targets, since each archive is built
  separately.
- Pin actions to commits like the other workflows.
- The first real run is the v0.1.0 tag in the release-proof quest. Before
  that, validate the workflow syntax and `dist generate --check` only.
- Mention the check in the release steps in `CONTRIBUTING.md`.
