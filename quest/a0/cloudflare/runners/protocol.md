# [L] Lock jobs with MoQ announcements

## Goal

A runner signs in to the app with a device flow and gets a scoped token for
the moq.pro relay. It reads a project's jobs from git, announces
`locks/<project>/<job>` to take one, and the relay grants each lock path to a
single session through the Worker's auth hook. The lock broadcast carries a
status snapshot and a log stream. The board lists active work from the
relay's announcements and plays any job's log live.

## Plan

- Job derivation is a pure core function (`src/core`), so the CLI, the Worker,
  and the Sandbox runner agree: ready quest without a change → run; an
  unfinished change with no live lock (a crashed run) or with answered
  `## Questions` → resume; a finished change missing a trusted check or
  review → check or review; maintainer-merged change → merge; main commit
  without a cache build → cache. Order: checks, reviews, merges, resumes,
  then runs, each by quest rank.
- A run or resume job ends by marking the change's head finished (a git note),
  so checks and reviews wait for finished heads and a half-done change from a
  crashed runner is resumed rather than orphaned.
- The runner registry lives in the app's database: owner, projects, systems,
  and tier (donor, trusted, or writer). Maintainers set tiers in the UI, and
  each tier's JWT only grants the lock paths for its job kinds.
- Leasing is not RPC. Exclusivity comes from the auth hook (or a "first
  announce wins" mode, if moq.pro adds one), and liveness comes from the
  session. Check moq.pro's support when starting.
- Use `@moq/net` over its WebSocket fallback, which works on Node and Bun.
  Confirm that a Bun-compiled binary connects.

## Required

- [Remove claims](/quest/a0/cloudflare/remove-claims.md) - nothing else marks work as taken
- [Fork intake](/quest/a0/cloudflare/intake.md) - sign-in, forks, tokens, and the repository registry
