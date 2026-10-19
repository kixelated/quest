# [M] Wake quest wait on required CI checks

## Goal

`quest wait` also reports the head's required CI results, so one blocking
wait covers reviews, merges, and CI. The `merge` skill drops its "own
blocking check watcher", which led 119 of 396 sessions to poll
`gh pr checks` or write their own `wait-ci.sh`.

## Plan

- Decided 2026-10-19 (user): add events to every wait rather than a separate
  `--checks` mode. `checks:failed` fires at the head's first failing required
  check; `checks:passed` fires once every required check on the head passes.
  Each event names the check and links its details.
- Decided (user): only required checks wake the wait. Read requiredness from
  GraphQL `isRequired(pullRequestNumber:)` on check runs and status contexts,
  which needs only read access and covers branch protection and rulesets. A
  repository with no required checks treats every check as required.
  Neutral and skipped results pass. Non-required failures never wake;
  `quest status` lists them.
- Report a check result reached after `--since`, so a wait started after CI
  finished still reports it. A new push starts over for the new head. The
  resume cursor records what was reported, so resuming never replays it.
- Read checks in the existing poll; keep its interval, rate-limit handling,
  and exit codes. Drop "Check runs ... are not activity" from `--help`.
- Update the `merge` and `complete` skill prose: one `quest wait` covers
  CI, so delete the separate check watcher.
- Test a required failure, an optional failure that does not wake, all
  required passing, no required checks, a push mid-wait, and resuming from
  a cursor after a reported result.
