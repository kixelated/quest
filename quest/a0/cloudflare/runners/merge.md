# [S] Merge changes on trusted runners

## Goal

When a maintainer merges a change in the UI, it becomes a merge job. A trusted
runner merges it into upstream main, or the Sandbox does when no trusted
runner is online. A conflict goes back to the change, as before.

## Plan

- Decided 2026-10-07: trusted runners do merges and checks. This amends "only
  the Worker writes to upstream", so the Worker issues a trusted runner a
  short-lived upstream token scoped to its merge job.
- Nothing merges without a maintainer.

## Required

- [Runner daemon](/quest/a0/cloudflare/runners/daemon.md) - the job loop
- [Changes](/quest/a0/cloudflare/changes.md) - the merge flow this moves onto runners
