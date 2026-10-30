# [L] Land batches from a host daemon

## Goal

`quest land serve` runs on the maintainer's host as a long-running daemon and
replaces the Land workflow; landing involves no GitHub Actions. It reads the queue (PRs auto-merging with a
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
  on the tip through a sandbox command the host configures, which receives
  the chain's checkout. On the maintainer's host it starts an ephemeral
  nspawn container ([host](/quest/m0/host-land/host.md)). The daemon refuses
  to start without one, and passes it no credential.
- **Logs** (user, 2026-10-30). An ejection comment carries the last ~100
  lines of the failing output; the full log stays in the daemon's state
  directory for the fixer and the maintainer.
  - ✅ A tail in the ejection comment
  - The full log as a secret gist
  - Through kix.quest's R2
- **Trust** (user, 2026-10-30). A maintainer approved the pinned head, so
  the gate evaluates its devShell even when it has non-maintainer commits.
  The pin is what makes that safe, so never check a head other than the
  pinned one.
  - Base devShell, untrusted flake changes handed back
  - Refuse untrusted heads until the VM ships
  - Wait for the VM
  - ✅ Fine as is: a maintainer already approved the merge
- **Credentials.** Read moq-bot's App key from a configured path, such as a
  systemd credential. Mint a moq-bot installation
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
- **Daemon.** One process per repository checkout. It reads the queue with
  one GraphQL call about once a minute and between batches, holds a lock so two never
  run, and resumes cleanly after a restart. Keep its code repository-agnostic
  so other repositories can adopt it.
- Test with a fake sandbox command and GitHub: the batch selection, a base conflict, a skipped conflicting PR, a
  failing tip ejecting the whole batch, a moved head, and a restart mid-batch.

## Related

- [Gate host](/quest/m0/host-land/host.md) - the host that runs it and lands the first live batch
