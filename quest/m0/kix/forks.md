# [S] Record each project's service fork by repository ID

## Goal

Two enrolled upstreams with the same repository name, such as `alice/app` and
`bob/app`, each publish through their own service fork. Publication finds a
project's fork by its stored GitHub repository ID, not by
`GITHUB_FORK_OWNER/<upstream name>`, so names can never collide or be
mistaken for one another.

## Plan

Decided 2026-10-19 as a follow-up of bot publication (#145), which looks the
fork up by the upstream's name:

- The operator keeps creating each fork by hand in the `GITHUB_FORK_OWNER`
  namespace, under any name (for example `bob-app`). The App gains no
  repository-creation permission.
- kix records the fork's repository ID per project when it first finds it,
  after verifying that the fork's parent is that project's upstream. Later
  publications use the ID and refuse a fork whose identity or parent has
  changed.
- How kix first finds a fork under a non-default name (an operator-entered
  name at enrollment, or a scan of the namespace for a fork whose parent is
  the upstream) is an implementation choice; prefer the one with fewer
  GitHub calls and no new permissions.
- A project with no recorded or discoverable fork keeps today's "provision
  the service fork first" refusal, naming what the operator must create.
- Disconnecting a project clears its recorded fork. Update the fork steps in
  `cloudflare/GITHUB.md`.
- Land this in m0 before launch: kix.quest is public in m0, so any enrolled
  repository could collide.
- Test two same-named upstreams, a fork with a changed parent, and a missing
  fork.

## Required

- [Operator setup](/quest/m0/kix/operator-setup.md) - the fork namespace and live fork behavior this builds on
