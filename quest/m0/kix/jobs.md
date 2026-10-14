# [M] Coordinate authorized jobs through the service database

## Goal

One authorized attempt owns a job at a time. The service durably records its
actor, repository revision, workflow, funding allocation, questions, status,
and result; executors exchange progress and cancellation through HTTPS.
Crashes, duplicate requests, and delayed workers cannot publish duplicate
results or spend from a revoked authorization.

## Plan

- Use D1 conditional writes/transactions for service state, job claims, and
  funding references. These records are real durable state, not merely a
  cache of git. GitHub still owns plans and code.
- Replace MoQ relay locking/live streams with database-backed ownership and
  ordinary HTTPS streams. Use one authority for claims; do not introduce a
  second scheduler for the later CLI or local runners.
- Separate planning, implementation, and explicitly requested iteration
  authorization. Newly arrived issues or review comments are data, not
  permission to run an action.
- Ready quests on an opted-in project's default branch are eligible.
  Project funding follows quest priority; an explicit spawn decision can
  promote selected ready work. Draft plans, active claims, and existing PRs
  prevent duplicate starts.
- Bind every mutation to the current attempt and revision. Recover stale
  ownership with fencing so a disconnected executor cannot later publish
  over its replacement. Reconcile uncertain external effects before retrying.
- Paused sessions preserve their questions and context. Resume an identified
  attempt/session after an authorized answer and funding check, rather than
  starting a new unrelated agent or guessing an answer.
- Project pause blocks new starts. Cancellation/revocation blocks further
  authorized work and requests termination; preserve partial results and
  account for in-flight work.
- The executor boundary exposes start/resume, structured prompts, progress,
  cancellation, and terminal results. Keep it portable for later local
  runners without building a general multi-provider scheduling platform.

## Required

- [Project state](/quest/m0/kix/repository.md) - pinned quests, existing PRs, and activity
- [API funding](/quest/m0/kix/funding.md) - durable spending authorization
