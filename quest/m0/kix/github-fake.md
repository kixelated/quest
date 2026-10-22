# [S] Run publication end to end against the seeded fake GitHub

## Goal

The seeded local server's fake GitHub (`cloudflare/dev/github.ts`) models
commits, fast-forward ref updates, and pull request creation, so the local
server can run a job's publication end to end, and publication tests use the
same fake instead of their own.

## Plan

Decided 2026-10-22 (user) as a follow-up of
[kixelated/quest#190](https://github.com/kixelated/quest/pull/190):

- `cloudflare/test/publish.test.ts` keeps its own stateful GitHub fake, while
  `dev/github.ts` models only what the inbox flows need. Merge the two into
  `dev/github.ts` and delete the test-local copy.
- The epic's end-to-end test starts from the seeded fake before the live
  rehearsal, so this ranks before the onboarding guide.
