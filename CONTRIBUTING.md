# Contributing

Use an isolated worktree under `.worktrees/` when practical. Keep each change
focused on an independently reviewable outcome. Plan durable work in `quest/`.

Use the pinned Nix development shell, shared with CI:

```sh
nix develop
just install  # Install the locked npm dependencies
just check
just test
just fix  # Apply formatting
just build
```

For automatic shell loading, install direnv and approve this checkout with
`direnv allow`. The Claude SessionStart hook loads an already-approved environment;
it does not grant approval. No background garbage collection runs on entry.

`flake.lock` pins Node and the developer tools; `package-lock.json` pins the npm
dependencies. The package's declared minimum Node version (`engines` in
`package.json`) is separate from the development pin. Without Nix, install the
tools listed in `flake.nix` and run the same just recipes.

`just test` runs vitest, the shell hook suites, the built CLI's lifecycle check,
and the Worker tests. `just check` includes TypeScript, formatting, workflow,
shell, and Nix checks in addition to quest validation.

`nix build` builds the package; `nix run -- --help` runs it. `nix flake check`
builds the Nix package and validates the repository's quest tree.

Use conventional commit subjects. Keep PR descriptions concise: explain the
problem, resulting behavior, validation, and any limitations. Start PRs as drafts
and mark them ready after checks pass. Merge only within the user's authorized
scope and after required repository checks and reviews pass. Never block on a
CodeRabbit review; it is optional.
Quest execution stops at PR creation; it merges only when the user picks /quest-merge.

Every AI-authored GitHub post must end with `(written by <model>)`, naming the
running model. This is separate from commit co-author trailers.

The package stays `private`; GitHub releases will ship the `quest` binary.

## Releases

Pushing a `vX.Y.Z` tag that matches `package.json`'s version runs the Release
workflow. It compiles `quest` with Bun for macOS and Linux (arm64 and x64),
runs the lifecycle check on each binary's native runner, and publishes the archives,
`SHA256SUMS`, and `quest-installer.sh` to a GitHub release. It then checks that
mise and the installer install the tag on every platform. A tag with a
prerelease suffix publishes a prerelease. `just compile` builds a binary for
this machine; the Bun in the Nix shell is the version releases use.

Do not push release tags or publish GitHub releases from ordinary development
work; that is a maintainer action after review.
