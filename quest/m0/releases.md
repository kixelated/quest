# [M] Publish release binaries

## Goal

Pushing a `vX.Y.Z` tag publishes macOS (arm64, x86_64) and Linux (x86_64,
arm64) binaries with checksums and a shell installer, in a layout mise's
`github:` backend installs without extra configuration. The flake package
keeps building the same version.

## Plan

- Use cargo-dist for the workflow, archives, checksums, and installer rather
  than a hand-rolled matrix.
- crates.io's `quest` and `quest-cli` are taken; the package stays
  `publish = false`. Binary name stays `quest`.
- Verify an install through mise (`mise use github:kixelated/quest@<version>`)
  and through the shell installer against a real prerelease tag.
- Pinning is the repository's tool manager's job (mise or a flake input); no
  launcher, no pin file.
- Document the release procedure in `CONTRIBUTING.md`.
