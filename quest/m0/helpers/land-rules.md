# [XS] quest land upholds only the rules GitHub lets it

## Goal

`quest land resolve` fails on a base whose ruleset has an `update` rule, and
the README's gate setup names only credentials and check sources GitHub
accepts, so an adopter's first ruleset write succeeds.

## Plan

Decided 2026-10-27 (user), from the follow-ups of
[kixelated/quest#229](https://github.com/kixelated/quest/pull/229):

- **Refuse `update` (user).** An `update` rule lets only its bypass actors
  move the base, but the gate's bypass lands any PR someone with write access
  queues, so treating the rule as upheld widens who can update. Drop `update`
  from `UPHELD` in `src/cli/land.ts`, so `resolve` names it among the rules it
  does not uphold, and fix the README sentence that lists what the push
  satisfies. Rejected: landing only PRs whose auto-merge a bypass actor
  enabled (it needs bypass, role, and team reads with admin access), and
  accepting `update` when the gate is the only bypass actor (it rules out an
  admin emergency bypass). No planned adopter uses the rule. Test that
  `resolve` refuses it.
- **Installed check app (user).** A ruleset's `required_status_checks` can pin
  only an app installed on the repository; GitHub rejects others with
  "Invalid integration ids". Say so where the README tells adopters to pin the
  `quest land` check's source.
- **No GitHub Actions bypass.** A repository ruleset refused GitHub Actions
  (`Integration` 15368) as a bypass actor on an organization repository
  (moq-dev/quest-land-scratch, 2026-10-26) and a personal one
  (kixelated/quest, 2026-10-27), both with "must be part of the ruleset source
  or owner organization". The README's credential paragraph stops offering it
  and names an App installed on the repository as the push bypass.

## Related

- [kixelated/quest lands through quest land](/quest/m0/helpers/land-adopt.md) - the first adopter, which follows this guidance
