# [L] Donate repository check capacity

## Goal

A project can authorize donated runners to execute its own checks against
a pinned revision and publish accurately attributed GitHub check results.

## Plan

- Use repository-defined tools rather than requiring every project to use Nix.
  Define runner trust and which results can satisfy protections before enabling
  authoritative checks; untrusted reports remain advisory.
- Run untrusted code apart from signing and publication credentials.
  Keep GitHub's native checks and existing CI authoritative.
- Share claims, cancellation, progress, and artifact/result handling.
  Never execute fork code in a privileged publisher.
- Test forged reports, changed heads, interrupted jobs, and duplicate events.

## Required

- [Local donor runner](/quest/m1/local/donor-runner.md) - contributed execution capacity
