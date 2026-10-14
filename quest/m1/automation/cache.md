# [M] Share an optional main-only Nix cache

## Goal

Projects using Nix can configure a signed public cache to speed up hosted
and local checks, with writes restricted to builds of merged default-branch
revisions.

## Plan

- Preserve the earlier R2-plus-signing-key proposal as the initial adapter;
  keep cache configuration optional and unrelated to Quest's core format.
- Separate writer credentials and hosts from unmerged code and agent jobs.
  Writers verify the source revision and build the merged default branch only.
- Publish substituter URLs/public keys per project; scope writes and lifecycle
  policies. Evaluate a managed upload service only if simple storage is inadequate.
- Verify readers reject unsigned paths and contribution runners cannot publish
  trusted cache entries.

## Required

- [Donated checks](/quest/m1/automation/checks.md) - runner configuration and trust model
