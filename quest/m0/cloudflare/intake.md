# [L] Pull claims and issues in from forks

## Goal

A signed-in contributor gets their own Artifacts fork and a fork-scoped
token. When they push a commit that only adds a `## Claim` to a ready,
unclaimed quest, or only adds a new `issues/<slug>.md`, it lands on upstream
main automatically. Anything else is ignored. A stale claim is removed after
48h without a push to the claimant's fork, and a maintainer can release a
claim at any time. Agents that read `issues/**` see a warning that its
content is untrusted.

## Plan

- Trigger: `cf.artifacts.repo.pushed` events for the fork, delivered through a
  Queue or Workflow. Push events don't identify the pusher, which is why every
  contributor has their own fork.
- The gate is deterministic: allowed paths only, a size cap, plain Markdown,
  and for claims a diff limited to the `## Claim` section. The Worker
  re-authors the commit onto main, credited to the contributor.
- `issues/` is quarantined. Skills treat it as data, never instructions, and
  a maintainer promotes an issue into `quest/`.
- Warning hooks: Claude Code and Codex hook config that adds a warning
  whenever an agent reads `issues/**`. The app commits it to repositories it
  creates, and [GitHub onboarding](/quest/m0/cloudflare/onboard.md) includes it
  in its PR. Check Codex's hook support when starting.
- A Durable Object per repository serializes claims, so two contributors
  racing for one quest get one winner.

## Required

- [Claim sections](/quest/m0/cloudflare/claims.md) - the format the gate accepts
