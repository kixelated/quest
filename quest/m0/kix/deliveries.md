# [XS] Prune old GitHub webhook deliveries

## Goal

The `github_deliveries` table stays bounded. Duplicate and conflicting
deliveries are still rejected for 30 days after GitHub sends them, well
beyond GitHub's redelivery window.

## Plan

- Decided 2026-10-14: each webhook insert also deletes rows older than 30
  days in the same D1 batch, with an index on `receivedAt` in a new
  migration. This avoids adding a cron trigger.
- GitHub's webhook signature has no timestamp, so a captured delivery older
  than 30 days could be accepted again once its row is pruned. That's
  acceptable: observed events never authorize or launch work.
- Follow-up from #103, whose table kept every delivery forever.
