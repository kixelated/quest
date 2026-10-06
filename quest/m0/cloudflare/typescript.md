# [L] Port Quest to TypeScript

## Goal

Quest's core and CLI are TypeScript, and Rust is gone: no `Cargo.toml`,
`src/*.rs`, `rust-toolchain.toml`, cargo-dist config, or wasm bridge. The
root package is the `quest` CLI, with `src/core` (pure parse, `check`, `ready`,
and claims, with no Node APIs) and `src/cli`. `cloudflare/` is an npm workspace
that imports `quest/core` directly, so the CLI, Worker, site, and map share one
implementation. `just check`, `just test`, the lifecycle CI job, and the nix
flake all run on the TypeScript build.

## Plan

Decided while planning on 2026-10-06, replacing the earlier "core as wasm"
plan (draft PR #39, which this closes):

- TypeScript everywhere rather than Rust plus wasm. One language and one
  implementation for every surface, without the wasm32 target, wasm-bindgen,
  or a JSON boundary. The Rust core was about 1,400 lines with three
  dependencies, so a port is cheap.
- Develop and test on Node with vitest, like the Worker. Bun only compiles
  release binaries ([Compiled releases](/quest/m0/cloudflare/release.md)).
- Port from this questline's branch, which has the newest core (claims,
  branches), and land there. It reaches main with the line.
- Cleanups are allowed: CLI output, `check` messages, and `--help` may change
  where they read better. List every user-visible change in the PR, and in the
  same PR update the README, docs, `quest guide`, and the skills that match on
  them (the user authorized editing `assets/` for this).
- Port the Rust tests first as the oracle, then apply the cleanups on top, so
  each behaviour change shows up as a test diff.
- The flake's package builds the CLI from source with Node, so nix users can
  pin any rev. mise pins only tagged releases. In this checkout, `quest` means
  `npm run quest --`; update `AGENTS.md`, the justfile, and the CI jobs.
- Parse Markdown with a CommonMark parser (for example mdast-util-from-markdown)
  in place of pulldown-cmark.
- Embed the guide, skills, and `assets/` in the bundle, so a compiled binary
  carries them as the Rust binary did.
