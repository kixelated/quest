set shell := ["bash", "-euo", "pipefail", "-c"]

# List the available development commands.
default:
    @just --list

# Check code, repository tooling, and the quest tree.
check:
    cargo fmt --all -- --check
    cargo clippy --locked --all-targets -- -D warnings
    dist generate --check
    cargo run --quiet --locked -- check
    cargo run --quiet --locked -- --root examples/export check
    actionlint
    shellcheck .claude/hooks/*.sh
    shfmt -d .claude/hooks/*.sh
    taplo format --check
    nixfmt --check flake.nix

# Run tests with bounded execution time, including documentation and shell hooks.
test:
    cargo nextest run --locked
    cargo test --locked --doc
    bash .claude/hooks/direnv.test.sh

# Apply formatters without changing program behavior.
fix:
    cargo fmt --all
    shfmt -w .claude/hooks/*.sh
    taplo format
    nixfmt flake.nix

# Build the standalone release binary.
build:
    cargo build --locked --release

# Run the local CLI, for example `just run ready`.
run *args:
    cargo run --quiet --locked -- {{args}}
