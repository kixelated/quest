# [M] Recover jobs from lost and blocked publications

## Goal

A maintainer can always get a failed or blocked kix job moving again from
the inbox, without visiting GitHub, and without losing answers already given.

## Plan

Decided 2026-10-21 from the follow-ups of
[kixelated/quest#171](https://github.com/kixelated/quest/pull/171) and
[kixelated/quest#172](https://github.com/kixelated/quest/pull/172):

- **Retry continuity.** A retried planning job's decision record includes
  earlier jobs' answers only when they delivered the same pull request
  (`store.decisions`). A failed job that pushed commits but never opened a PR
  loses its answered rounds on retry. Record which job a retry continues when
  the retry is created (`createJob`) and follow that chain instead.
- **Start over (user).** A blocked-branch decision ("changed outside this
  job", `cloudflare/src/jobs/publish.ts`) gains a "Start over" choice: kix
  resets the service-owned fork branch to the base and restarts the job.
  Today answering only resumes the agent, which cannot clear the branch. The
  same path clears leftover branches from completed or cancelled work.
  Rejected: pausing with instructions to fix the branch on GitHub.
- **Unrecorded pull requests.** A failed job can open its pull request but
  fail before recording the number. Its retry is then refused, because
  `deliver` adopts only PRs created since the current job and observations
  lack the PR's head repository (a Codex finding declined on
  [kixelated/quest#171](https://github.com/kixelated/quest/pull/171)). Adopt that
  PR on retry when it is the only open PR from the job's branch.
- Test each path with the seeded fake GitHub (`cloudflare/dev/github.ts`).
