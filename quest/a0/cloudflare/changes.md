# [L] Review and merge changes

## Goal

A branch on a contributor's fork that is named for a quest shows up as a
change against upstream main. Maintainers see its diff and `quest check`
result, comment, approve, and merge it in the web UI. A conflict is shown on the change for the contributor's
agent to resolve.

## Plan

- One change model: a quest proposal is just a change that only touches
  `quest/`.
- Comments and approvals are git notes (`refs/notes/quest`) on the change's
  commits, so they sync and agents can read them. The app only caches them.
- Diff, merge, and notes run real git in a Sandbox, because Artifacts has no
  merge or diff API.
- Amended 2026-10-07 by [runners](/quest/a0/cloudflare/runners/README.md):
  the `quest check` Workflow and Worker-only merges in draft PR #41 are
  interim. [Flake checks](/quest/a0/cloudflare/runners/checks.md) and
  [runner merges](/quest/a0/cloudflare/runners/merge.md) replace them, the
  Worker and trusted runners both write upstream, and the
  [Sandbox runner](/quest/a0/cloudflare/runners/sandbox.md) reuses the Sandbox
  merge code as the fallback. Don't extend the Workflow checks.
