# [S] Fix the runner's post-merge review findings

## Goal

Two `quest runner` processes never work in the same runner home at once, and
the `context` tool returns every unresolved review thread of a pull request,
however many threads it has.

## Plan

Decided 2026-10-22 (user) from Codex's post-merge review of
[kixelated/quest#188](https://github.com/kixelated/quest/pull/188)
([review](https://github.com/kixelated/quest/pull/188#pullrequestreview-5618747276)),
which covered rework that merged without a review:

- **One runner per home (user).** `quest runner run` takes an exclusive lock
  on its runner home and refuses to start while another process holds it.
  The per-repository lock in `src/runner/workspace.ts` serializes only within
  one process, so a second runner on the same home could reuse and modify a
  job worktree while the first one's agents are still stopping after the hub
  reassigns their jobs
  ([P1](https://github.com/kixelated/quest/pull/188#discussion_r4351848499)).
  Rejected: inter-process locks per repository and worktree, which allow
  several runners per home at more complexity. The lock must release when its
  holder dies, on Linux and macOS.
- **Page review threads.** The context query in
  `cloudflare/src/github/service.ts` reads only the first 100 review threads
  before filtering unresolved ones, so a newer unresolved thread on a busy PR
  is silently omitted
  ([P2](https://github.com/kixelated/quest/pull/188#discussion_r4351848505)).
  Follow `pageInfo` cursors until every thread is examined.
- Ranked first in the epic, since both fix merged code. Test a second runner
  refused on a held home, a lock released after a crash, and a pull request
  with more than 100 review threads.
