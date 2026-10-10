# [M] Wait for pull request activity

## Goal

`quest wait <pr> [--since <point>]` blocks until the pull request has activity
after the point, prints the new events, and exits. Activity is a review, a
comment, a push, a merge, or a close. The agent decides what the events mean;
the tool does not know who counts as a reviewer.

The merge and complete skills, and any other skill that waits on a review or a
merge, call `quest wait` instead of polling GitHub by hand. The README and
`--help` document the command in the same change.

## Plan

Decided on 2026-10-07, after five quest-merge sub-agents in moq-dev/moq.pro
polled GitHub for reviews in hand-rolled loops. Together they tripped GitHub's
secondary rate limit for the whole account, and several misread the rate-limit
error bodies as results: one reported a review that did not exist, another a
head that had not moved. A command polls once, carefully, for every agent.

- The CLI may call GitHub (the [a0](/quest/a0/README.md) amendment of
  2026-10-07). Keeping the calls in the CLI makes them testable instead of
  re-implemented in every agent's prose.
- `--since` defaults to the current head's push time, so activity on that
  head is never missed, even if it landed before the command started. It also
  takes a timestamp, or a SHA meaning that commit's push time.
- No noise filter: print every event. The skills tell the agent to re-run with
  `--since` after events it ignores, such as bot notices. Filtering would put
  a reviewer policy in the tool.
- One REST call to the issue timeline per poll, every 5 minutes. Back off on
  403 and 429. Validate every response, and never treat an error body as an
  event.
- No cap by default: it waits until activity or an interrupt. A skill that
  needs a bound passes its own `--timeout`.

### Facts checked on 2026-10-07

- `GET /repos/{o}/{r}/issues/{n}/timeline` returns `reviewed` (`submitted_at`,
  `commit_id`, `state`), `commented` (`created_at`), `line-commented` and
  `commit-commented` (a `comments` array, each with `created_at`),
  `committed`, `merged`, `closed`, and `head_ref_force_pushed` (`created_at`).
  Seen on kixelated/quest#84 and moq-dev/moq.pro#2243, and in the
  [timeline schema](https://docs.github.com/en/rest/issues/timeline).
- Gap: `committed` events carry only the git author and committer dates, not
  a push time, and a plain push has no event of its own. Only a force push
  gets a timestamped `head_ref_force_pushed`. Detect a new push as a
  `committed` SHA that the timeline did not hold at the point, not by date.
- Push time: `GET /repos/{o}/{r}/activity?ref=<branch>` lists `push`,
  `force_push`, and `branch_creation` entries with `timestamp`, `before`, and
  `after`. A SHA's push time is the `timestamp` of the entry whose `after` is
  that SHA. Seen on kixelated/quest's `quest/a0/theme/map-links`
  ([docs](https://docs.github.com/en/rest/repos/repos#list-repository-activities)).
  For a fork PR, query the head repository (`head.repo` from
  `GET /repos/{o}/{r}/pulls/{n}`).
- Gap: a SHA that was not a push's tip, a deleted head branch, or a deleted
  fork has no activity entry. Fail and ask for a timestamp `--since`, rather
  than guess.
- The timeline is ascending and pages at most 100 events. One call per poll
  means fetching the last known page (from `Link: rel="last"`) and following
  `next` only when it fills.
- A conditional request (`If-None-Match` with the last ETag) that returns 304
  does not count against the primary rate limit. On a rate limit, honor
  `retry-after`, else `x-ratelimit-reset` when `x-ratelimit-remaining` is 0,
  else wait at least a minute and back off exponentially
  ([GitHub's guidance](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)).
- Out of scope: edits to existing comments or reviews (only `updated_at`
  changes) and check runs, which the timeline does not carry.

### Guidance for the implementer

- Recommended, confirm when starting: take the token from `GH_TOKEN` or
  `GITHUB_TOKEN`, else `gh auth token` (the skills already require `gh`), and
  accept a PR number in the `origin` repository or a PR URL.
- Piped output is one plain line per event: its time (or SHA for a commit),
  type, actor, and URL, so the last line names the next `--since`. Activity
  exits 0; a timeout exits with its own non-zero code; any other failure is
  loud.
- Inject the HTTP client and the clock so the tests never sleep or hit the
  network. Cover an error body never printed as an event, the default point
  catching a review that predates the call, a plain push and a force push, a
  page rollover, and an unresolvable `--since` SHA.
