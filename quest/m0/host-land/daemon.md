# [L] Land batches from a host daemon

## Goal

`quest land serve` runs on the maintainer's host as a long-running daemon and
replaces the Land workflow. It reads the queue (PRs auto-merging with a
`quest merge --land` pin), builds a batch, checks the chain's tip once, and
fast-forwards `main` as moq-bot when it passes, one squash commit per PR.
When the base PR conflicts with `main` or the batch fails, it ejects the batch
and starts the fixer. It never bisects.

## Plan

Decided 2026-10-30 (user, /quest-plan); see the
[epic](/quest/m0/host-land/README.md).

- **Batch.** The base is the longest-queued PR. Add the next PRs in queue
  order that merge cleanly onto the chain with the quest merge driver, up to
  floor(log₂ n) for n queued PRs. A PR that conflicts with the chain is
  skipped and stays queued. Only the base's own conflict ejects it.
- **Check.** Run the repository's check (`just check` and `just test` here)
  on the tip through `quest gate`, in the runner's sandbox
  (`src/runner/sandbox.ts`): no home directories, GitHub token, `gh` config,
  SSH agent, or keys, and network only to package registries.
- **Trust** (user, 2026-10-30). A maintainer approved the pinned head, so
  the gate evaluates its devShell even when it has non-maintainer commits.
  The pin is what makes that safe, so never check a head other than the
  pinned one.
  - Base devShell, untrusted flake changes handed back
  - Refuse untrusted heads until the VM ships
  - Wait for the VM
  - ✅ Fine as is: a maintainer already approved the merge
- **Credentials.** Run as the gate's own user
  ([setup](/quest/m0/host-land/bot-key.md)). Mint a moq-bot installation
  token for each push, scoped to this repository with contents and
  pull-request write, adding workflows write only when the batch touches
  `.github/workflows`.
- **Eject.** On a failing tip, eject every PR in the batch: disable
  auto-merge, remove `quest:merge`, and comment with the reason, keeping the
  hidden marker `quest status` reads. Keep the resolve-time ejections
  (`head_moved`, `not_pinned`, review and check states).
- **Delete** land.yml, `quest land check`'s bisection and `--budget`, and the
  three-phase split that existed to keep the credential away from CI. Drop
  the ID-token guard in `test/workflows.test.ts`. `token.moq.dev`'s land
  endpoint lives in moq-dev/moq; suggest its removal there as a follow-up.
- **Daemon.** One process per repository checkout. It reacts to the queue by
  reading GitHub's state cheaply between batches, holds a lock so two never
  run, and resumes cleanly after a restart. Keep its code repository-agnostic
  so other repositories can adopt it.
- Test the batch selection, a base conflict, a skipped conflicting PR, a
  failing tip ejecting the whole batch, a moved head, and a restart mid-batch.

## Required

- [Gate host setup](/quest/m0/host-land/bot-key.md) - the gate's user can push as moq-bot and reach Codex
