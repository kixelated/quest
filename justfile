set shell := ["bash", "-euo", "pipefail", "-c"]

# List the available development commands.
default:
    @just --list

# Install the locked npm dependencies for the CLI and the Worker.
install:
    npm ci

# Check code, repository tooling, and the quest tree.
check:
    npm run check
    npm run --silent quest -- check
    npm run --silent quest -- --root examples/export check
    actionlint
    shellcheck .claude/hooks/*.sh scripts/*.sh
    shfmt -d .claude/hooks/*.sh scripts/*.sh
    nixfmt --check flake.nix nix/*.nix
    just worker-check

# Run tests, including the shell hooks and the lifecycle of both builds.
test:
    npm test
    bash .claude/hooks/direnv.test.sh
    bash scripts/install-check.test.sh
    bash scripts/installer.test.sh
    npm run build
    bash scripts/lifecycle-check.sh "$PWD/dist/quest.js"
    npm run compile
    bash scripts/lifecycle-check.sh "$PWD/dist/quest"
    just worker-test

# Apply formatters without changing program behavior.
fix:
    npm run fix
    shfmt -w .claude/hooks/*.sh scripts/*.sh
    nixfmt flake.nix nix/*.nix
    npm run fix -w cloudflare

# Build the bundled CLI into dist/quest.js.
build:
    npm run build

# Compile a standalone binary for this machine into dist/quest.
compile:
    npm run compile

# Run the local CLI, for example `just run ready`.
run *args:
    npm run --silent quest -- {{args}}

# Check generated binding types, TypeScript, formatting, and deployment bundle.
worker-check:
    npm run check -w cloudflare

# Run Worker integration tests in the Cloudflare runtime.
worker-test:
    npm test -w cloudflare

# Apply auth migrations locally and start the Worker.
worker-dev:
    npm run migrate -w cloudflare
    npm run dev -w cloudflare
