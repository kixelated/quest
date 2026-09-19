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
scope and after required repository checks and reviews pass.
Quest execution stops at PR creation; merging requires a separate invocation.

Every AI-authored GitHub post must end with `(written by <model>)`, naming the
running model. This is separate from commit co-author trailers.

Do not publish packages or releases as part of ordinary development. The package
is intentionally marked `publish = false` until release naming and distribution
are settled.
