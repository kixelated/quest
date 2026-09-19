# Contributing

Use an isolated worktree under `.worktrees/` when practical. Keep each change
focused on an independently reviewable outcome. Plan durable work in `quest/`.

With Rust 1.91 or newer, run the same checks as CI:

```sh
cargo fmt --all -- --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
cargo run --locked -- check
```

Use conventional commit subjects. Keep PR descriptions concise: explain the
problem, resulting behavior, validation, and any limitations. Start PRs as drafts
and mark them ready after checks pass. Merge only within the user's authorized
scope and after required repository checks and reviews pass.

Every AI-authored GitHub post must end with `(written by <model>)`, naming the
running model. This is separate from commit co-author trailers.

Do not publish packages or releases as part of ordinary development. The package
is intentionally marked `publish = false` until release naming and distribution
are settled.
