# [M] kixelated/quest lands through quest land

## Goal

PRs to kixelated/quest's `main` land only through
`quest land`, on a hosted runner, running
`just check` and `just test` once per batch. GitHub's merge button cannot
land around it. A PR from a fork lands through it too.

## Plan

Decided 2026-10-26 (user): the repository adopts its own gate first. Being
user-owned, it cannot use GitHub's merge queue
([landing](/quest/m0/helpers/landing.md)).

- **Push credential (user, 2026-10-27).** A GitHub App owned by the kixelated
  account, installed only on this repository, is the `main` ruleset's bypass
  actor. Only the land job mints its token, from a key in an environment only
  `main` can use, as moq-dev/quest-land-scratch verified with moq-bot.
  GitHub Actions cannot be the bypass: a disabled probe ruleset on this
  repository was refused on 2026-10-27 with "must be part of the ruleset
  source or owner organization". The user creates the App and stores its
  key.
- A test refuses `contents: write` anywhere but the land job, as moq.pro's
  `queue.test.ts` does. The land job keeps it on `GH_TOKEN`, which ejecting a
  PR needs. The admin role keeps its emergency bypass. Ruleset writes are the
  user's.
- The ruleset requires the `quest land` check, pinned to an app installed on
  this repository that never reports it, so auto-merge only waits for the
  gate. It replaces the classic protection that requires `check`.
- **Forks (user, 2026-10-27).** The fork path was never verified live, since
  moq-dev forbids private forks. This quest is done only once a fork PR that
  allows maintainer edits lands through the gate and shows as merged; any fix
  that needs lands here.
- Update `CONTRIBUTING.md`'s landing section; the user asked for it through
  this plan.

## Related

- [quest land upholds only the rules GitHub lets it](/quest/m0/helpers/land-rules.md) - the README setup guidance this follows
