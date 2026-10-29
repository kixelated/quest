# [XS] Plan a delegated merge's follow-ups

## Goal

One guide rule defines how callers hand off a published delegate's suggested
follow-ups for a separate `/quest-plan` invocation. Consolidate the copies in
`complete.md` and `spawn.md` while preserving each skill's particular workflow.
Published coding agents terminate rather than starting another interview.

## Plan

Decided 2026-10-29 (user, publish-and-terminate workflow): an agent finishes
locally, publishes, reports the handoff, and terminates. This supersedes the
post-publication automatic interview trigger below. Follow-up planning can run
before a caller's final publication or in a separate invocation, never by
keeping the published coding agent alive. The remaining work is to consolidate
that handoff rule in the guide.

Historical decision, superseded only as to the post-publication trigger:

Decided 2026-10-28 (user, /quest-plan of the follow-ups from [kixelated/quest#271](https://github.com/kixelated/quest/pull/271)).

- [kixelated/quest#266](https://github.com/kixelated/quest/pull/266) made a
  foreground `/quest-merge`, `/quest-complete`, and `/quest-spawn` plan
  follow-ups without asking. A single `/quest-merge` run as a background
  agent only lists them in its report, and no rule told the caller to plan
  them: #271's follow-ups waited for the user to ask.
- The rule belongs in the guide, beside "A suggested follow-up becomes a quest
  only through `/quest-plan`", so it covers any skill that delegates a merge.
  `complete.md` and `spawn.md` keep only what is specific to them, such as
  waiting until every sub-agent has finished.
- `/quest-afk` still holds follow-ups for the user, since it runs no
  interview.
- Also update the guide's "`/quest-merge` decides which to plan", which
  predates #266.
