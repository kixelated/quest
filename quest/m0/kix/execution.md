# [L] Spawn and iterate work from decision prompts

## Goal

A maintainer starts ready work through kix.quest, follows it through agent
summaries, answers its questions, and receives a normal contribution PR. New
PR notifications present useful next actions, including explicitly
requested iteration, in the same decision UI.

## Plan

- Use the same runners, prompt contract, and publisher as planning instead
  of a separate agent orchestration stack.
- Apply quest-spawn selection/readiness behavior, including the
  `quest unblocked` within-milestone impact ranking, and the existing
  quest-start/quest-iterate workflows. A project opt-in authorizes eligible
  ready default-branch quests; explicit UI selection can prioritize work.
  Draft or blocked plans and already active/open work are not started again.
- Each job owns a recoverable checkout inside the project's Nix devShell and
  runs applicable checks. Checkpoint and release at blocking handoffs and job
  completion, restoring on resume with unresolved work and check results.
  The product does not replace a project's GitHub CI.
- Questions and significant findings pause into the UI with context,
  recommendations, and choices. Explicitly selected revisions resume the
  relevant session/PR with fresh authorization.
- Preserve results when the agent stops, fails, its account hits a limit,
  or its runner goes offline. Report the actual state and next action; do
  not mask failures with repeated runs.
- Stop implementation at PR delivery. Subsequent review/iteration/merge
  choices are explicit maintainer actions, with GitHub enforcing its normal
  review and merge rules. Independent donated reviews and CI come later.
- Cover the real prompt loop in integration tests, including simultaneous
  starts, a stale PR head, a blocked decision, an exhausted account, and a
  runner going offline mid-job.

## Required

- [Web planning](/quest/m0/kix/planning.md) - the complete decision/session/publication path
- [Agent activity](/quest/m0/kix/activity.md) - how maintainers follow running work
- [Job sandbox](/quest/m0/kix/sandbox.md) - safe iteration on PRs with contributors' commits
