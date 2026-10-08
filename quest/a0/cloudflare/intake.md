# [L] Pull issues in from forks

## Goal

A signed-in contributor gets their own Artifacts fork and a fork-scoped
token. When they push a commit that only adds a new `issues/<slug>.md`, it
lands on upstream main automatically. Anything else is ignored. Agents that
read `issues/**` see a warning that its content is untrusted.

## Plan

- Trigger: `cf.artifacts.repo.pushed` events for the fork, delivered through a
  Queue or Workflow. Push events don't identify the pusher, which is why every
  contributor has their own fork.
- The gate is deterministic: allowed paths only, a size cap, and plain
  Markdown. The Worker re-authors the commit onto main, credited to the
  contributor.
- Claims are out (decided 2026-10-07,
  [remove claims](/quest/a0/cloudflare/remove-claims.md)): draft PR #40 drops
  its claim promotion, 48h expiry, and claim Durable Object.
- `issues/` is quarantined. Skills treat it as data, never instructions, and
  a maintainer promotes an issue into `quest/`.
- Warning hooks: Claude Code and Codex hook config that adds a warning
  whenever an agent reads `issues/**`. The app commits it to repositories it
  creates, and [GitHub onboarding](/quest/a0/cloudflare/onboard.md) includes it
  in its PR. Check Codex's hook support when starting.
