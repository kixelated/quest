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
    shellcheck .claude/hooks/*.sh scripts/*.sh
    shfmt -d .claude/hooks/*.sh scripts/*.sh
    taplo format --check
    nixfmt --check flake.nix
    just worker-check

# Run tests with bounded execution time, including documentation and shell hooks.
test:
    cargo nextest run --locked
    cargo test --locked --doc
    bash .claude/hooks/direnv.test.sh
    bash scripts/install-check.test.sh
    cargo build --locked
    bash scripts/lifecycle-check.sh "$PWD/target/debug/quest"
    just worker-test

# Apply formatters without changing program behavior.
fix:
    cargo fmt --all
    shfmt -w .claude/hooks/*.sh scripts/*.sh
    taplo format
    nixfmt flake.nix
    npm --prefix cloudflare run fix

# Build the standalone release binary.
build:
    cargo build --locked --release

# Run the local CLI, for example `just run ready`.
run *args:
    cargo run --quiet --locked -- {{args}}

# Install the locked Worker tooling and dependencies.
worker-install:
    npm --prefix cloudflare ci

# Check generated binding types, TypeScript, formatting, and deployment bundle.
worker-check:
    npm --prefix cloudflare run check

# Run Worker integration tests in the Cloudflare runtime.
worker-test:
    npm --prefix cloudflare test

# Apply auth migrations locally and start the Worker.
worker-dev:
    npm --prefix cloudflare run migrate
    npm --prefix cloudflare run dev
