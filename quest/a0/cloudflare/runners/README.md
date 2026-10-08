# Runners

## Goal

Anyone installs `quest runner` on their own machines, and those machines do a
project's agent work and CI instead of GitHub. A runner connects to Quest on
Cloudflare, finds the next job in git, locks it with a MoQ announcement, and
does it: implementing ready quests, resuming answered ones, flake checks,
agent reviews, merges, and main builds for a shared Nix cache. Maintainers
watch the active work live on the board and answer runner questions in the UI.
The app's Cloudflare Sandbox is a fallback trusted runner on the same protocol,
so a project works with no self-hosted runner online. Self-hosting is optional
(hosted Sandboxes stay, and paid hosting may come later). GitHub stays a synced
mirror for contributor credit.

This README owns the work no child does: an end-to-end test (two runners race
for one ready quest with a stub agent; one wins the lock; it blocks on
`## Questions`; a maintainer answers in the inbox; a runner resumes; a trusted
runner checks and reviews; the maintainer merges; a writer pushes main to the
cache; a killed runner frees its lock), and `docs/runners.md` (installing a
runner, trust tiers, agents, and the cache).

## Plan

Decided while planning on 2026-10-07, after GitHub CI kept starting from a
blank slate. Research: no existing tool runs CI and agent sessions across a
pool of personal and donated machines with trust tiers. Garnix shut down
(2026-07), and buildbot-nix uploads to its cache from every build, PRs
included. Nix makes write-on-merge simple because output paths are input
hashes, so a change's build can't overwrite main's paths.

- **Git is the queue, MoQ announcements are the locks.** Nothing durable is
  held. A shared core function derives each project's jobs from git: a ready
  quest with no open change is a run job, a change whose `## Questions` are
  answered is a resume job, a change without a trusted check or review needs
  one, an approved change the maintainer merged is a merge job, and a main
  commit without a cache build is a cache job. A runner wins a job by
  announcing `locks/<project>/<job>` on the moq.pro relay. A crashed session
  unannounces, so its job frees at once, with no expiry.
- **The Worker arbitrates locks through the relay's auth hook**, granting each
  lock path to one session, and mints scoped JWTs for runners and the board.
  moq.pro is the maintainer's own relay; if it lacks an exclusive grant or a
  per-tenant auth hook, add it there.
- **Live work over MoQ.** The lock broadcast also carries a status snapshot and
  a log stream (`@moq/json`), which the board subscribes to. This reverses the
  earlier "watching a run live is a non-goal".
- **Trust tiers.** A signed-in contributor's runner is a donor by default and
  only does run and resume jobs. Maintainers mark runners as trusted; trusted
  runners do all checks, reviews, and merges, and only their results are
  authoritative. Writers are trusted runners that hold the cache signing key
  and build merged main only, never unmerged code, so a sandbox escape in a
  change can't poison the cache. The Sandbox is a trusted fallback, never a
  writer.
- **Tokens.** A runner spends its owner's own agent login (Claude Code, Codex,
  OpenCode, or Sign in with ChatGPT). That counts as a local runtime the user
  controls under OpenAI's terms. The Sandbox runner spends keys stored in the
  app.
- **Decisions go to maintainers; runners never prompt.** An agent that needs a
  decision ends its job with a blocked commit that adds `## Questions`. A
  maintainer answers in the UI, and the unblock commit makes the change a
  resume job. Nothing merges without a maintainer, and reviews don't trigger
  automatic iteration.
- **Auto-run.** A runner opts into projects with a concurrency limit. When
  idle, it takes the highest-ranked job: checks, reviews, and merges before
  resumes, and resumes before new runs.
- **Sandboxing in a0.** Checks rely on Nix's build sandbox. Agents run in a
  fresh worktree under their own native sandbox (bubblewrap or Seatbelt).
  Runners require Nix 2.34.5 or later (CVE-2026-39860). microVMs for untrusted
  donors are [a1](/quest/a1/donor-isolation.md).
- Both backends ship in a0, despite the 2026-10-14 deadline, because live
  multi-runner coordination is the demo's agent-collaboration story.

## Required

- [Remove claims](/quest/a0/cloudflare/remove-claims.md) - `## Claim` leaves the format; locks and open changes replace it
- [Questions section](/quest/a0/cloudflare/runners/questions.md) - `## Questions` blocks a quest until a maintainer answers
- [Locks and live work](/quest/a0/cloudflare/runners/protocol.md) - job derivation from git, runner sign-in and trust tiers, and moq.pro announce locks with live status
- [Runner daemon](/quest/a0/cloudflare/runners/daemon.md) - `quest runner` and `quest run` lock jobs and drive the owner's logged-in agents
- [Nix cache](/quest/a0/cloudflare/runners/cache.md) - an R2 substituter every runner reads, written only by main builds on writer runners
- [Flake checks](/quest/a0/cloudflare/runners/checks.md) - trusted runners build each change's flake checks per system
- [Agent reviews](/quest/a0/cloudflare/runners/review.md) - trusted runners review every change and post git-note verdicts
- [Runner merges](/quest/a0/cloudflare/runners/merge.md) - a maintainer's merge becomes a job a trusted runner executes
- [Sandbox runner](/quest/a0/cloudflare/runners/sandbox.md) - the app's Sandbox runs funded quests and is the trusted fallback
- [Decision inbox](/quest/a0/cloudflare/runners/inbox.md) - maintainers answer runner questions as interactive prompts
- [Board actions](/quest/a0/cloudflare/runners/board-actions.md) - spawn ready quests onto runners and complete approved changes from the board
