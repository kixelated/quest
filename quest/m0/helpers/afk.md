# [XS] Triage unattended with an afk argument

## Goal

`/quest-complete afk` and `/quest-spawn afk` act on their recommendations
without asking, except merges and deletes. This replaces the prompt the
user keeps typing before stepping away: "skip/iterate any that you
recommend, and prompt for any that you recommend I merge... relatively
simple decisions only".

## Plan

- Decided 2026-10-19 (user): one shared `afk` argument for both skills, not
  a new default and not limited to `/quest-complete`.
- In afk mode, dispatch recommended skip, `/quest-iterate`, and
  `/quest-ready` picks without asking. Still ask about every merge and
  delete, as one simple question each with the recommendation first.
- A decision that is not simple becomes a skip with a note in the summary
  rather than a question. Suggested `/quest-plan` follow-ups wait for the
  summary, since planning is an interview.
- The rest of the argument still filters the PRs or quests in scope, as
  today.
- Edit `assets/skills/complete.md` and `assets/skills/spawn.md`, following
  `PROMPTING.md`.
