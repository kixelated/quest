# [S] kixelated/quest lands through quest land

## Goal

PRs to kixelated/quest's `main` land only through
`quest land`, on a hosted runner, running
`just check` and `just test` once per batch. GitHub's merge button cannot
land around it. A PR from a fork lands through it too.

## Plan

Decided 2026-10-26 (user): the repository adopts its own gate first. Being
user-owned, it cannot use GitHub's merge queue
([landing](/quest/m0/helpers/landing.md)).

[kixelated/quest#236](https://github.com/kixelated/quest/pull/236) added the
Land workflow, a test that only its land job uses the `land` environment, and
`CONTRIBUTING.md`'s landing rule. What remains is the user's setup and the live
verification.

- **Push credential (user, 2026-10-27).** A GitHub App owned by the kixelated
  account, installed only on this repository, is the `main` ruleset's bypass
  actor. GitHub Actions cannot be: a disabled probe ruleset on this repository
  was refused on 2026-10-27 with "must be part of the ruleset source or owner
  organization". The user creates the App with Contents and Workflows write
  (Workflows lets it land PRs that change `.github/workflows`), and no
  webhook. The `land` environment, deployable only from `main`, holds its
  client ID as the variable `LAND_APP_CLIENT_ID` and its key as the secret
  `LAND_APP_PRIVATE_KEY`.
- **Ruleset (user).** `main`'s ruleset blocks deletion and non-fast-forward
  pushes and requires two checks: `check` from GitHub Actions, and
  `quest land` pinned to the land App, which has no checks or statuses
  permission and so never reports it. Its bypass actors are the land App and
  the admin role, which keeps an emergency bypass. It replaces the classic
  protection that requires `check`. Ruleset writes are the user's.
- **Forks (user, 2026-10-27).** The fork path was never verified live, since
  moq-dev forbids private forks. This quest is done only once a fork PR that
  allows maintainer edits lands through the gate and shows as merged; any fix
  it needs lands here. GitHub offers maintainer edits only on forks a user
  owns, not an organization.
- The PR that finishes this quest lands through the gate, verifying the
  same-repository path.
