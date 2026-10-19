# [S] Render planning decisions into PRs from recorded answers

## Goal

A planning PR published by kix carries a decision section that the service
writes from the job's recorded questions and answers, with ✅ on each chosen
option and any free-text answer. The agent no longer writes its own paper
trail, so the record cannot be paraphrased or drift from what the maintainer
actually chose.

## Plan

Decided 2026-10-19 as a follow-up of bot publication (#145), which takes the
paper trail from the agent's quest files and PR body:

- The service renders the section from the job's stored questions and
  answers (the decision inbox's prompt contract) when it creates or updates
  the planning PR. Include only answered `agent` questions whose prompt is a
  `decision`, not a `permission` request. Operational question kinds such as
  `account` and `publication` stay out, since they can name runners and
  accounts in a public PR.
- Prompts and answers are untrusted text. Escaping Markdown is not enough:
  also neutralize GitHub's own semantics, so no `@` mention notifies anyone,
  no `#N`, `owner/repo#N`, or commit reference autolinks, no bare URL links,
  and no closing keyword (`Closes #N`, `Fixes`, `Resolves`) links or closes
  an issue. For example, render all prompt text in code spans or break each
  pattern with a zero-width character.
- Replace, don't append: the agent's PR body keeps its summary, and the
  service owns the decision section. Re-rendering on later deliveries
  updates the same section in place rather than duplicating it.
- Quest files still record each settled decision and its reason in their
  Plan, as the guide requires; this changes only the PR's paper trail.
- Tell agents in kix planning jobs, through the job's own instructions
  rather than the shared skills, not to write the trail. Local agents running
  the skills without kix keep writing their own.
- Test multi-round interviews, free-text answers, a re-delivery that
  updates the section, and a planning job that hit an account limit, whose
  account question must not appear. Cover hostile prompts with Markdown,
  `@user` and `@org/team` mentions, bare URLs, issue and cross-repository
  references, and closing keywords.

## Required

- [Decision inbox](/quest/m0/kix/prompts.md) - the recorded prompt and answer format this renders
