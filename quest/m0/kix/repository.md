# [M] Read project state and activity from GitHub

## Goal

The service reads an enrolled repository's Quest tree at a known default-
branch commit and observes its issues, PRs, and relevant check/review state.
New issues and new PRs each create a durable notification for maintainers,
with webhook replay producing no duplicate item.

## Plan

- GitHub is authoritative. Cache snapshots and API responses as needed.
- Reuse the board's `Project` seam and the pure quest parser/readiness
  functions. Keep source commit IDs with derived state so stale plans do
  not authorize new execution.
- Native issues remain untrusted source material. Receiving an issue queues
  a decision item; it does not itself authorize a model call, create a quest,
  or spend an account's usage.
- Associate contribution PRs with their quests and runs. An existing PR or
  active claim prevents duplicate implementation of that quest.
- Observe all new repository PRs for the requested maintainer workflow,
  including human-authored PRs; only link one to a quest when evidence
  supports that association.
- New entities produce notifications; later pushes/comments update their
  existing item and surface newly required decisions without a stream of
  duplicate notices. Reconcile missed events against GitHub.
- PR review and check data informs recommendations, never substitutes for
  maintainer authorization or GitHub's merge rules.

## Required

- [Project enrollment](/quest/m0/kix/onboard.md) - enrolled repositories and their maintainers
