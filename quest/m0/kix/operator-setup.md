# [S] Set up the Kix bot's pilot repositories

## Goal

The operator supplies a service-controlled fork namespace and installs the
registered GitHub App on it and on the pilot repositories. A real issue event
and a bounded test PR verify the integration before contributors are invited.

## Plan

- This is an operator/setup outcome. App registration and its secrets belong
  to [Deploy kix.quest](/quest/m0/kix/deploy.md), because every deploy needs them.
- The operator chooses the fork namespace during setup. The bot identity is
  distinct from that namespace; do not assume an App can own a fork by itself.
  Set it as `GITHUB_FORK_OWNER` (steps 3 and 5 of `cloudflare/GITHUB.md`).
- Validate real installation-token behavior across upstream and
  service-owned forks, which publication's tests only mock (Publication in
  `cloudflare/GITHUB.md`): an upstream token opening a pull request whose head
  is on the fork's separate installation, a fork commit whose parent is an
  upstream commit pushed after the fork was made, GitHub's signature on the
  App's API commits, and an iteration pushing an upstream pull request head
  under branch rules. Disable Actions on the service forks.
- Install the PWA and receive a push notification on real Android, iOS, and
  desktop devices (from
  [kixelated/quest#165](https://github.com/kixelated/quest/pull/165), whose
  tests use fakes).
- Read a deleted issue by number against a real installation, which the
  background reconcile from
  [kixelated/quest#170](https://github.com/kixelated/quest/pull/170) only
  tests against the fake.
- Rehearse on the operator's own runner and an explicitly selected
  operator account.
- Record nonsecret setup/run instructions and deployment identifiers.
  Remove the quest when the setup condition is fulfilled.

## Required

- [Deploy kix.quest](/quest/m0/kix/deploy.md) - the live origin and registered App
