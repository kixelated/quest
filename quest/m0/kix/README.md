# Kix decision UI

## Goal

An open-source maintainer works through a simple, guided decision inbox on
`https://kix.quest`: a new GitHub issue leads into a quest-plan interview,
ready quests can be started, and each new PR brings the next review or
iteration decision. Claude Agent SDK sessions plan, implement, and revise
work; the GitHub App bot publishes ordinary PRs. Maintainers choose the
consequential actions through interactive prompts.

The maintainer can use their own API key, or donor funding authorized for
that kind of work. Donors can allocate a project budget or fund an individual
quest. Projects use Quest files in their GitHub repository; merging a plan
and opting the project in makes its ready quests eligible for implementation.

This epic owns an end-to-end test of the whole flow: enroll a project,
receive an issue notification, answer planning prompts, publish a draft
quest PR, merge through GitHub's rules, fund and start a ready quest, answer
an implementation question, and receive its contribution PR notification.
Exercise duplicate events, interrupted sessions, and exhausted funding with
stubbed agents/providers before a bounded operator-funded live rehearsal.

## Plan

Decided on 2026-10-13 through the API-credit and product-pivot interview:

- **UI first.** The primary surface is the current decision, with context,
  a recommendation, a few choices, and a free-text answer. Keep settings,
  funding details, repository views, and logs secondary. Do not turn the
  home screen into a collection of monitoring dashboards.
- **Hosted planning and implementation first.** This supersedes the earlier
  local-workers-first staging. The operator pays bounded hosting costs;
  API usage comes from an explicitly selected maintainer or donor account.
  The standalone API-worker CLI and local Claude Code plugin follow in
  [local integrations](/quest/m1/local/README.md).
- **GitHub first.** GitHub owns repositories, issues, PRs, reviews, and
  existing CI. No Artifacts mirror, separate changes system, git-note
  approvals, or custom merge executor. GitHub merges require a maintainer's
  explicit choice and the repository's checks and protections.
- **A real GitHub App bot.** The service publishes as its App identity,
  credits donors, and keeps GitHub credentials outside agent processes.
  The bot identity and the account owning its contribution forks are
  separate concepts.
- **Ready means eligible.** After a maintainer opts in, ready quests on the
  default branch may receive donated implementation. Draft plans are not
  eligible. Project pause stops new work. An explicit spawn decision can
  prioritize ready work without introducing another approval flag per quest.
- **Funding follows donor intent.** Support both project allocations and
  individual-quest allocations. Planning uses the maintainer's API account
  by default; donors must explicitly allow planning. Do not silently switch
  funding accounts when an allocation expires or runs out.
- **Keep useful infrastructure.** Retain Workers/Hono and D1 for the web
  service. Keep the Agent SDK executor portable and outside the Workers
  isolate, with a Cloudflare Sandbox adapter for the initial hosted runtime.
  Durable database claims and HTTPS streams replace MoQ locks and logs.
- **Implementation before donated infrastructure.** Agents run applicable
  repository checks, but a global Nix requirement, donated CI, independent
  agent reviews, cache writers, and runner trust tiers do not gate this
  release. [Later automation](/quest/m1/automation/README.md) owns those
  additional capabilities.
- **No contest constraint.** The Cloudflare competition and its deadline
  no longer determine scope, hosting, or launch order.
- **Independent core.** Keep provider, GitHub, Cloudflare, and UI behavior
  outside the pure quest core. The standalone CLI and versioned quest
  format remain useful without this service.

## Required

- [Deploy kix.quest](/quest/m0/kix/deploy.md) - the operator registers the App and deploys the Worker with GitHub sign-in at kix.quest
- [Operator setup](/quest/m0/kix/operator-setup.md) - fork namespace, pilot installations, and a verified test PR
- [GitHub project state](/quest/m0/kix/repository.md) - quest snapshots, issues, PRs, and deduplicated events
- [API funding](/quest/m0/kix/funding.md) - explicit donor allocations, credentials, accounting, and revocation
- [Job coordination](/quest/m0/kix/jobs.md) - durable claims, authorization, cancellation, and HTTPS progress
- [Agent SDK runtime](/quest/m0/kix/runtime.md) - isolated resumable sessions with structured prompts and results
- [Decision inbox](/quest/m0/kix/prompts.md) - a simple prompt UI with new-issue and new-PR notifications
- [Bot publication](/quest/m0/kix/publication.md) - validated agent results become normal GitHub PRs
- [Web planning](/quest/m0/kix/planning.md) - issue-to-quest interviews produce draft planning PRs
- [Web execution](/quest/m0/kix/execution.md) - spawn and iterate through the UI, ending in contribution PRs
- [Onboarding guide](/quest/m0/kix/guide.md) - a complete maintainer and donor path through the product
