# Kix decision UI

## Goal

kix.quest is a cloud for creating software. Maintainers make decisions in a
phone-friendly web app with push notifications, while kix routes the work to
any runner they own, using whatever agent accounts they connect. CLIs and
providers stay hidden behind summaries and prompts.

A new GitHub issue leads into a quest-plan interview, ready quests can be
started, and each new PR brings the next review or iteration decision: the
existing skills' workflow, through the web. Runners are the maintainer's own
Linux and macOS machines, which come and go offline. Each one drives the
official agent CLIs (Claude Code, opencode) with any number of signed-in
accounts. The GitHub App bot publishes ordinary PRs.

This epic owns an end-to-end test of the whole flow: enroll a project,
connect two runners, one with two accounts, receive an issue notification,
answer planning prompts, publish a draft quest PR, merge through GitHub's
rules, start a ready quest, follow its summaries, answer an implementation
question from a push notification, take its runner offline so the job is
reassigned to the other, and receive its contribution PR notification. Exercise duplicate events,
interrupted sessions, and an exhausted account with stubbed agents before a
live rehearsal on the operator's runner.

## Plan

Decided on 2026-10-15 through the decisions-not-implementations interview,
superseding the 2026-10-13 hosted-first, Claude-SDK-only, and
operator-paid-hosting decisions:

- **Decisions, not implementations.** The maintainer only makes decisions;
  agents do all the implementing. Prompts and agent-written summaries are
  the whole default UI. Raw agent output is collapsed behind a per-job
  disclosure that only current maintainers can expand.
- **Phone first.** m0 ships an installable PWA with Web Push for decision
  items. A [native mobile app](/quest/m1/mobile-app.md) follows in m1.
- **Your own runners first.** `quest runner` turns any Linux or macOS machine
  into a runner. It claims jobs over HTTPS and drives the official CLIs with
  that machine's own logins, so kix never holds provider tokens. There are no
  Windows runners. Free, capped [cloud runners](/quest/m1/cloud/README.md)
  and API-key or donor funding follow in m1, with paid compute later.
- **Abstract the CLIs.** A runner adapter interface hides each CLI: start or
  resume, structured questions, checkpoint summaries, and results. Claude
  Code covers Claude subscriptions; opencode covers OpenCode Go, ChatGPT
  plans, and API-key providers. There is no separate Codex adapter unless
  opencode's ChatGPT support falls short.
- **Many accounts, no rotation.** A runner offers any number of accounts,
  each signed in by its own CLI in an isolated home. kix stores opaque
  account IDs and routes by the user's preference order. A job that hits a
  limit pauses with a decision to switch accounts; kix never rotates
  automatically to dodge provider limits.
- **Nix only.** Runners run every job inside the project's `nix develop`
  shell, with no other way to install dependencies, for cache efficiency and
  reproducibility. The runner pins the agent CLIs through Nix as well.
  Runners keep a persistent local store and honor the flake's substituters;
  a [shared cache](/quest/m1/automation/cache.md) follows in m1.
- **Sandboxed jobs.** Every job's commands run in an OS sandbox. PR heads
  with non-maintainer commits route to Linux runners, which build the PR's
  devShell in a VM first; macOS runners take trusted revisions only. Cloud
  runners are Linux-only.
- **Auto-routing.** kix picks an online runner with a usable account; the
  maintainer may pin one. Runners push checkpoints, through the service, to
  the job's fenced branch, and an offline runner's job is reassigned
  automatically from that branch.
- **GitHub first.** GitHub owns repositories, issues, PRs, reviews, and
  existing CI. No Artifacts mirror, separate changes system, git-note
  approvals, or custom merge executor. GitHub merges require a maintainer's
  explicit choice and the repository's checks and protections.
- **A real GitHub App bot.** The service publishes as its App identity and
  keeps GitHub credentials off runners. The bot identity and the account
  owning its contribution forks are separate concepts.
- **Ready means eligible.** After a maintainer opts in, ready quests on the
  default branch may be implemented. Draft plans are not eligible. Project
  pause stops new work. An explicit spawn decision can prioritize ready work
  without introducing another approval flag per quest.
- **Keep useful infrastructure.** Retain Workers/Hono and D1 for the web
  service. Durable database claims and live WebSocket connections to a
  per-owner Durable Object (decided 2026-10-16 on kixelated/quest#135)
  replace MoQ locks and logs.
- **Not exclusive.** The web UI is one interface, not the only one. Every
  skill keeps working from a user's own agent (Claude Code, Codex, ...)
  without kix. The two coexist through GitHub: kix sees a local agent's
  quest branches and PRs, which count as claims and get the usual PR
  decision items. There is no plugin or session mirroring.
- **One owner per quest and PR** (decided 2026-10-20 from a transcript
  audit, see [quest start](/quest/m0/helpers/start.md)). Claims are draft
  PRs. A PR is owned while it is a draft without a `## Decisions needed`
  section or carries one `quest:*` state label, shared with local sessions. There is no repository-wide merge agent and no user-facing
  parallelism limit; runner slots and account quota cap it.
- **Independent core.** Keep provider, GitHub, Cloudflare, and UI behavior
  outside the pure quest core. The standalone CLI and versioned quest
  format remain useful without this service.

## Required

- [Local harness](/quest/m0/kix/harness.md) - the Worker served locally with seeded data and mocked GitHub for browser checks
- [Deploy kix.quest](/quest/m0/kix/deploy.md) - the operator registers the App and deploys the Worker with GitHub sign-in at kix.quest
- [Operator setup](/quest/m0/kix/operator-setup.md) - fork namespace, pilot installations, and a verified test PR
- [Per-project forks](/quest/m0/kix/forks.md) - each project publishes through its own fork, recorded by repository ID
- [Runner](/quest/m0/kix/runner.md) - `quest runner` on Linux and macOS with Nix devShells, accounts, and the Claude Code adapter
- [Job sandbox](/quest/m0/kix/sandbox.md) - OS-sandboxed commands, with untrusted PR devShells built in a VM on Linux runners
- [opencode adapter](/quest/m0/kix/opencode.md) - OpenCode Go, ChatGPT plans, and API-key providers through opencode
- [Webhook reconcile](/quest/m0/kix/reconcile.md) - new issues and PRs arrive in the inbox ready to act on, without a manual refresh
- [Inbox merge](/quest/m0/kix/merge.md) - PR items merge the reviewed head through GitHub's rules
- [Merge jobs](/quest/m0/kix/merge-job.md) - a merge pick fixes conflicts, CI, and reviews on a runner, then lands the PR
- [Co-maintainer inbox](/quest/m0/kix/members.md) - every current maintainer sees enrolled projects in their inbox
- [Answer flow](/quest/m0/kix/answer-flow.md) - move to the next decision after an answer, with neutral refusals
- [Retry from the branch](/quest/m0/kix/retry.md) - a retried job continues from the head its failed attempt published
- [Decision paper trail](/quest/m0/kix/paper-trail.md) - planning PRs carry the recorded questions and answers, rendered by the service
- [Agent activity](/quest/m0/kix/activity.md) - agent cards and map highlights built from checkpoint summaries
- [Web planning](/quest/m0/kix/planning.md) - issue-to-quest interviews produce draft planning PRs
- [Web execution](/quest/m0/kix/execution.md) - spawn and iterate through the UI, ending in contribution PRs
- [Onboarding guide](/quest/m0/kix/guide.md) - a complete maintainer path, from runner setup through a reviewed PR
