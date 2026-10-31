# [S] quest land checks queued PRs before batching them

## Goal

Problems that one PR can be blamed for are caught before that PR joins a
batch, so they never eject the whole batch. When a PR is queued, `quest
land` reports which other queued PRs it conflicts with. Before batching,
each PR passes `quest check` against the current base, and a PR that fails
is ejected alone with that output.

## Plan

Decided 2026-10-31 (user, /quest-plan of the follow-ups from a moq-dev/moq
`/quest-complete` run).

- Queued PRs that conflict with each other:
  [moq-dev/moq#6994](https://github.com/moq-dev/moq/pull/6994) and
  [moq-dev/moq#7196](https://github.com/moq-dev/moq/pull/7196) both edited
  `drafts/draft-lcurley-moq-lite.md`. Report the overlap at queue time, so
  the later PR's author can fix it before its turn comes. `build` in
  `src/cli/land.ts` already merges each PR onto the chain with the quest
  driver, and can run that merge pairwise.
- Dangling links: [moq-dev/moq#7135](https://github.com/moq-dev/moq/pull/7135)
  linked to a quest the base had already finished, which failed its batch.
  Run `quest check` on each PR merged onto the current base, a cheap step,
  before the full batch check.
- [Sibling PRs through a server-side merge](/quest/m0/helpers/queue-siblings.md)
  owns the same dead-link failure on gates that are not `quest land`, and
  may instead make `quest check` tolerate links to finished quests. Whichever
  lands first, the other quest drops what is already covered.

## Related

- [Sibling PRs through a server-side merge](/quest/m0/helpers/queue-siblings.md) - the dead-link failure on other gates
- [Batch triage](/quest/m0/host-land/triage.md) - blame for failures these checks miss
