# [L] Isolate untrusted local donor jobs

## Goal

Local donors can run projects they do not trust in a supported VM boundary
with constrained network and filesystem access, without exposing host secrets.

## Plan

- Hosted m0 already requires isolated containers and external credentials.
  This quest strengthens local donor execution; Nix build isolation alone
  is not an isolation boundary for arbitrary agent commands.
- Evaluate current microVM tooling and supported Linux/macOS hosts before
  selecting an adapter. Do not make a beta runtime a core requirement.
- Keep provider keys and publication credentials outside guests, and enforce
  per-job authorization and egress. Document residual risks and unsupported hosts.
- Verify filesystem, network, credential, teardown, and interrupted-job boundaries.

## Required

- [Local donor runner](/quest/m1/local/donor-runner.md) - the execution path this hardens
