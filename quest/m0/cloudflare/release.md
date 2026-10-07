# [M] Release compiled TypeScript binaries

## Goal

Tagging a release publishes per-platform `quest` binaries built with
`bun build --compile` for macOS and Linux on arm64 and x64, plus a shell
installer, on GitHub Releases. `mise use github:kixelated/quest@<tag>` and the
installer work on them, the install check runs after publishing, and `SETUP.md`
describes only the TypeScript-era install paths.

## Plan

Decided while planning on 2026-10-06:

- Single compiled binaries rather than an npm package. Users need no runtime
  (native Claude Code and Codex installs don't guarantee Node), and the mise
  and nix pins keep working. The cost is roughly 60 MB per binary.
- Replaces cargo-dist, which [the port](/quest/m0/cloudflare/typescript.md)
  removes along with Rust. Nothing is tagged yet, so no published pin breaks.
- Lands on the Cloudflare questline's branch, where the TypeScript CLI lives.
- Unreleased pins go through the nix flake's source build. There are no
  rolling prereleases. Remove the `cargo:` rev pin and `cargo install` from
  `SETUP.md`.
- Windows stays m1 ([Windows](/quest/m1/windows.md)), even though Bun can
  compile for it.

## Required

- [Port to TypeScript](/quest/m0/cloudflare/typescript.md) - the CLI this releases
