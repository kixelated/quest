# [M] Coordinate jobs across runners through the service database

## Goal

One authorized attempt owns a job at a time. The service durably records its
actor, repository revision, workflow, runner, account, questions, status,
summaries, and result, and routes it to an online runner with a usable
account. Runners exchange progress and cancellation through HTTPS. Crashes,
offline runners, duplicate requests, and delayed runners cannot publish
duplicate results or overwrite a replacement's work.

## Plan

- Use D1 conditional writes/transactions for service state, job claims,
  runner presence, and account references. These records are real durable
  state, not merely a cache of git. GitHub still owns plans and code.
- Replace MoQ relay locking/live streams with database-backed ownership and
  ordinary HTTPS streams. One authority makes claims, for own-PC runners now
  and cloud runners later.
- Decided 2026-10-15: auto-route each job to an online runner offering an
  account for a suitable provider, in the user's account preference order.
  The maintainer may pin a runner or account in a secondary control. Never
  move a job to another account because one hit its limit; pause it with a
  decision instead.
- Decided 2026-10-15: when a runner goes offline mid-job, reassign the job
  automatically after a timeout. The replacement continues from the job's
  fenced branch (the last checkpoint) and its summaries. Fence the old
  attempt so a returning runner cannot publish over its replacement.
- Separate planning, implementation, and explicitly requested iteration
  authorization. Newly arrived issues or review comments are data, not
  permission to run an action.
- Ready quests on an opted-in project's default branch are eligible. An
  explicit spawn decision can promote selected ready work. Draft plans,
  active claims, and existing PRs prevent duplicate starts. A quest branch
  pushed by someone's local agent is a claim too, since the skills keep
  working without kix.
- Jobs on PR heads containing non-maintainer commits route only to Linux
  runners, which build the PR's devShell in a VM
  ([sandbox](/quest/m0/kix/sandbox.md)).
- Runners require a Nix devShell. A project without a flake devShell gets a
  decision offering a bootstrap job to add one, rather than a failed start.
  That job is the one exception to running in the project's shell: it runs
  in the runner's own pinned Nix environment, and publication only accepts
  flake files from it.
- Paused sessions preserve their questions and context. Resume an identified
  attempt/session after an authorized answer, rather than starting a new
  unrelated agent or guessing an answer.
- Project pause blocks new starts. Cancellation blocks further work and
  requests termination; preserve partial results.
- Store checkpoint summaries as the job's progress record and raw agent
  output separately, readable only by current project maintainers.
