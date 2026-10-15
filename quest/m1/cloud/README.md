# Cloud runners

## Goal

A maintainer clicks one button to add cloud runners alongside their own
machines. Cloud runners are the same runner in a hosted container, using
connected API keys or donor allocations, and look like any other runner in
routing and the UI.

## Plan

Decided 2026-10-15 in the decisions-not-implementations interview:

- Cloud runners follow the m0 own-machine runners and reuse the same runner,
  job protocol, Nix devShell requirement, and adapters.
- Start with free cloud compute: the operator pays hosting under a spend
  cap. Paid compute comes later in its own quest, once usage justifies it.
- Hosted runners use API keys only. Provider terms make hosted subscription
  use conditional (Claude) or high-risk (Google), so subscriptions stay on
  the user's own machines.

## Required

- [Hosted runners](/quest/m1/cloud/runners.md) - free, capped cloud runners enabled with one click
- [API funding](/quest/m1/cloud/funding.md) - API keys and donor allocations for cloud runners
- [Paid compute](/quest/m1/cloud/billing.md) - charge for cloud runner compute once free capacity is not enough
