# [XS] Land private repositories through the host gate

## Goal

`quest land serve` fetches the base and queued heads with a read-only
installation token, so a private repository such as moq-dev/moq.pro can land
through it. The token never reaches the sandbox or the fixer.

## Plan

Decided 2026-10-30 (user, /quest-plan of the follow-ups from
[moq-dev/quest#297](https://github.com/moq-dev/quest/pull/297)):

- Rank:
  - ✅ m1, after launch, since other repositories adopting the gate is a
    non-goal of the [host gate epic](/quest/m0/host-land/README.md)
  - m0, in the host gate epic
  - Drop it
- The daemon's fetches and `ls-remote` calls carry no credential today. Pass
  a `contents: read` token to git only, the way its merge tokens are passed,
  and test a fetch against a private fake.
