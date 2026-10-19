# [S] Read the inbox's jobs in one query per project

## Goal

Loading the decision inbox runs a fixed number of D1 queries per project,
however many jobs, issues, PRs, and quests it shows. Today
`listInboxJobs` reads each returned job with its own `readJob` batch.

## Plan

Decided 2026-10-19 as a follow-up of the decision inbox (#144), whose final
review fix made the inbox return every observed target's latest job:

- m1: m0 pilots track few targets per repository, and D1 calls within the
  Worker are cheap, so this waits until after launch.
- Replace the per-job `readJob` batches with one joined query, or one batch
  of a constant number of queries, per project. Keep the output identical,
  including questions, answers, and attempt state.
- Add a test that seeds many jobs and asserts that the number of D1 queries
  per inbox load does not grow with them.
