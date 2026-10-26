# [M] Keep the inbox live and current

## Goal

The inbox updates agent cards as summaries arrive, the quest log shows which
quests have active jobs, every job type offers the runner and account choice,
and old "plan these?" offers expire.

## Plan

Decided 2026-10-24 (user) as follow-ups of
[kixelated/quest#215](https://github.com/kixelated/quest/pull/215) and
[kixelated/quest#205](https://github.com/kixelated/quest/pull/205), ranked
after launch:

- **Live cards.** Cards refresh only on page load. Push summaries from the
  runner hub to open inbox pages, over the existing per-owner connection or
  Server-Sent Events, keeping summaries escaped and raw output behind its
  maintainer-only disclosure.
- **Active quests.** The quest log shows a quest as ready while a job is
  queued or running on it; show the job's state instead, from the same card
  data.
- **Runner choice everywhere.** The folded runner and account control exists
  only on the new plan box; offer it when starting or iterating work too.
- **Offer expiry.** "Plan these?" offers are capped at the newest 50 per
  project; expire them by age instead.
