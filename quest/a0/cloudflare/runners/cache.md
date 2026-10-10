# [M] Share a Nix cache written only from main

## Goal

Every runner, and the Sandbox runner, substitutes from a public R2 bucket
signed by the project's cache key, so checks start warm. When a change
merges, writer runners take one cache job per system, build main's flake
outputs, and push them with `nix copy`. No one else can write to the bucket.

## Plan

- Decided 2026-10-07: plain R2 plus a signing key held only by writer runners.
  niks3 (presigned uploads, OIDC write policy, garbage collection) is the
  upgrade path if R2 lifecycle rules can't keep the bucket in check.
- Writers build merged main only and never run change checks or agent jobs, so
  a sandbox escape in unmerged code can't plant paths that a writer then signs.
  Expect one desktop for Linux and the Mac for `aarch64-darwin`.
- The app serves the substituter URL and public key per project, and runners
  configure them automatically. A runner's own `/nix/store` stays warm between
  jobs.

## Required

- [Runner daemon](/quest/a0/cloudflare/runners/daemon.md) - the job loop that cache jobs run in
