# [S] The fixer survives an ejection and recognises collateral PRs

## Goal

After every batch ejection on moq-dev/moq, the fixer runs to completion and
records a result for each PR. A PR that was ejected only because it shared a
batch with the failing one is recognised as collateral and requeued, so no
maintainer has to hand it back. When the fixer does fail, its handback says
why, using its exit status and the end of its log.

## Plan

Decided 2026-10-31 (user, /quest-plan of the follow-ups from a moq-dev/moq
`/quest-complete` run). On 2026-10-31 the fixer crashed on every ejection, so
the maintainer handed collateral PRs back by hand
([moq-dev/moq#7416](https://github.com/moq-dev/moq/pull/7416),
[moq-dev/moq#7413](https://github.com/moq-dev/moq/pull/7413)). The failures
seen:

- Exit 101, after a flood of `cargo_cyclonedx` "Hash not found in
  Cargo.lock" errors. The fixer ran a check the container cannot complete,
  or one that does not apply to the failure.
- Exit 143, which means it was killed by SIGTERM: the timeout in
  `collectJob` (`src/cli/land-fixer.ts`), or the host stopping the unit.
- "fixer disappeared before recording an exit status; run /quest-iterate"
  (`collectJob`). That text hides which of the two happened. Record the
  exit status, or that the daemon restarted, and the tail of
  `fixerLog`.

Find each crash's cause in the host's per-job logs before changing anything.
Fix what is quest's here, and what is the host's wrapper or container in
kixelated/nixos as part of the [gate host](/quest/m0/host-land/host.md).
Cover a crashing fixer and a collateral requeue in the fixer tests.

## Related

- [Fixer proxy access](/quest/m0/host-land/fixer.md) - the fixer container's model access
