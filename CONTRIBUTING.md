# Contributing

Use an isolated worktree under `.worktrees/` when practical. Keep each change
focused on an independently reviewable outcome. Plan durable work in `quest/`.

Use the pinned Nix development shell, shared with CI:

```sh
nix develop
just check
just test
just fix  # Apply formatting
just build
```

For automatic shell loading, install direnv and approve this checkout with
`direnv allow`. The Claude SessionStart hook loads an already-approved environment;
it does not grant approval. No background garbage collection runs on entry.

`rust-toolchain.toml` pins Rust for both rustup and Nix. `flake.lock` pins the
remaining developer tools. The package's declared minimum Rust version is
separate from the development toolchain pin. Without Nix, install the tools
listed in `flake.nix` and run the same just recipes.

`just test` uses nextest with bounded test execution, then runs documentation
tests and the direnv hook regression suite. `just check` includes workflow,
shell, TOML, and Nix checks in addition to Rust and quest validation.

`nix build` builds the package; `nix run -- --help` runs it. `nix flake check`
builds and tests the Nix package and validates the repository's quest tree.

Use conventional commit subjects. Keep PR descriptions concise: explain the
problem, resulting behavior, validation, and any limitations. Start PRs as drafts
and mark them ready after checks pass. Merge only within the user's authorized
scope and after required repository checks and reviews pass. Never block on a
CodeRabbit review; it is optional.
Quest execution stops at PR creation; it merges only when the user picks /quest-merge.

Every AI-authored GitHub post must end with `(written by <model>)`, naming the
running model. This is separate from commit co-author trailers.

The crate stays `publish = false` (the `quest` name on crates.io is taken). Tagged
GitHub releases ship the `quest` binary instead.

## Releases

[cargo-dist](https://axodotdev.github.io/cargo-dist/) builds archives with
checksums and a shell installer (`.github/workflows/release.yml`). Artifacts use
the `quest-<target-triple>.tar.xz` layout so mise's `github:` backend can
install without extra configuration, for example
`mise use github:kixelated/quest@v0.1.0`.

The version in `Cargo.toml` is the source of truth for releases and for the Nix
package (`nix build` / `nix flake check` build that version from source).

Maintainers cut a release after the version bump lands on `main`:

1. Confirm `Cargo.toml` has the intended version and `dist plan` looks right
   (`nix develop --command dist plan`).
2. Run `just check` and `just test`.
3. Push an annotated tag `vX.Y.Z` (for example `v0.1.0`). The Release workflow
   builds macOS (arm64, x86_64) and Linux (x86_64, arm64) artifacts and opens
   a GitHub Release.
4. Smoke-test installs (`mise install github:kixelated/quest@vX.Y.Z`, or the
   generated `quest-installer.sh` from the release assets).

Do not push release tags or publish GitHub releases from ordinary development
work; that is a maintainer action after review.
