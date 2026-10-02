# [M] Scaffold the Cloudflare Worker

## Goal

`cloudflare/` holds a deployable TypeScript Worker. It has an Artifacts
binding, D1, a Durable Object for per-repository coordination, and GitHub
sign-in. `nix develop` provides node and wrangler, and `just check` and
`just test` cover the Worker and run in CI.

## Plan

- Auth goes through a pluggable layer (for example better-auth on D1), so
  [More logins](/quest/m0/cloudflare/logins.md) only adds providers.
- Keep the stack minimal (for example Hono with server-rendered JSX). Pick
  the stack when starting, and record why.
- One Artifacts namespace per deployment, with each project as a repository.
- Document local development and deployment in `cloudflare/README.md`.
