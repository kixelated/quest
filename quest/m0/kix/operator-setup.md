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
  service-owned forks.
- Configure the operator's hosting limit and explicit API funding for the
  rehearsal. A live test must not draw on an unidentified donor account.
- Record nonsecret setup/run instructions and deployment identifiers.
  Remove the quest when the setup condition is fulfilled.

## Required

- [Deploy kix.quest](/quest/m0/kix/deploy.md) - the live origin and registered App
- [Bot publication](/quest/m0/kix/publication.md) - the integration exercised by the test PR
