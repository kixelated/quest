# [L] Make interactive decisions the main UI

## Goal

After signing in, a maintainer sees a simple decision inbox and can work
through contextual prompts with recommendations, choices, and free-text
answers. Every new GitHub issue and PR produces a notification. Refreshing
or reconnecting preserves the current question and submitted answers.

## Plan

- The user emphasized simplicity on 2026-10-13: the maintainer primarily
  does quest-plan for new issues and quest-spawn for ready work, then handles
  the PRs that arrive. Optimize that loop before secondary dashboards.
- Present one active decision thread, showing the issue/quest/PR, relevant
  context, recommendation, choices, and free text. A planning round may
  contain independent questions; dependent questions wait for the answers.
- The model generates contextual questions; the UI renders them and returns
  the maintainer's selected answers. Distinguish product decisions from
  tool permission requests and from ordinary informational progress.
- New issue: offer planning or an appropriate skip/defer action. Ready
  quest: offer starting/prioritizing it. New PR: offer the next review,
  iteration, or permitted GitHub merge decision. Capability and authorization
  determine available actions; do not display nonworking promises.
- Use in-app unread notifications as the baseline and offer browser
  notifications with user opt-in. Coalesce updates into the same decision
  item; a reconnect or duplicate webhook must not create another prompt.
- Decisions are bound to a project, current maintainer, session, and
  question/revision. Reject stale or duplicate submissions safely. Agent
  recommendations and other users' comments are never approval.
- Surface waiting-for-answer, active, funding-exhausted, and failed states
  plainly, with the next useful action. Keep detailed logs, account setup,
  budgets, and repository browsing available as secondary views.
- Reuse the established visual identity and existing components where they
  help. Maps, status grids, and configuration screens are not the primary
  signed-in experience. Preserve keyboard and accessible form behavior.

## Required

- [Project state](/quest/m0/kix/repository.md) - issues, PRs, quests, and notification events
- [Job coordination](/quest/m0/kix/jobs.md) - durable questions and authorized answers
