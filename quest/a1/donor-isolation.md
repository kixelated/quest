# [M] Isolate donor runner jobs in microVMs

## Goal

A runner can run each job in a microVM (microsandbox on Linux KVM and Apple
silicon), so contributors can safely donate machines to projects they don't
fully trust, and trusted runners can take checks without risking their host.
Network access is limited to an allowlist, and no secret enters the VM except
the job's own.

## Plan

- Decided 2026-10-07: a0 relies on Nix's build sandbox and the agents' native
  sandboxes; microVMs come with untrusted donors.
- Re-check microsandbox's maturity (beta as of 2026-10). microvm.nix is the
  NixOS-only alternative.
- Consider letting trusted self-hosted runners use API keys stored in the app,
  which the maintainer floated as a maybe.

## Required

- [Quest on Cloudflare](/quest/a0/cloudflare/README.md) - the runners this hardens
