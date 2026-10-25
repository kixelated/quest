# [S] Read every page of a PR's context

## Goal

The runner's `context` tool returns all of a pull request's comments,
reviews, review-thread comments, and check contexts, however busy the PR is.

## Plan

Decided 2026-10-24 (user) as a follow-up of
[kixelated/quest#210](https://github.com/kixelated/quest/pull/210), which
paged review threads in `cloudflare/src/github/service.ts`:

- The same query still caps the first 50 comments in each thread, the last
  100 PR comments, the last 50 reviews, and 100 check contexts, so a busy PR
  silently drops the rest. Follow each connection's `pageInfo` cursor, and
  raise an error on a missing or repeated cursor instead of looping, as #210
  does.
- Test each list past its page size with the seeded fake GitHub
  (`cloudflare/dev/github.ts`).
